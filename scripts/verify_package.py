#!/usr/bin/env python3
"""Verify a package's digest, contents, target and version; extract for native tests."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tarfile
import zipfile

from package import ROOT, host_target


def verify(directory, version, target, destination):
    directory, destination = Path(directory), Path(destination)
    digest, name = (directory / 'SHA256SUMS').read_text().strip().split('  ')
    archive = directory / name
    assert archive.parent == directory and archive.is_file(), name
    with archive.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == digest, 'checksum mismatch'
    destination.mkdir(parents=True, exist_ok=True)
    if archive.suffix == '.zip':
        with zipfile.ZipFile(archive) as bundle:
            assert all(not Path(n).is_absolute() and '..' not in Path(n).parts for n in bundle.namelist())
            bundle.extractall(destination)
    else:
        with tarfile.open(archive) as bundle:
            bundle.extractall(destination, filter='data')
    info = json.loads((destination / 'BUILDINFO.json').read_text())
    assert info == json.loads((directory / 'BUILDINFO.json').read_text())
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    assert info == {'version': version, 'commit': commit, 'target': target}, info
    for file in ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/GUIDE.md',
                 *[p.relative_to(ROOT).as_posix() for p in (ROOT / 'docs/licenses').rglob('*') if p.is_file()]]:
        assert (destination / file).read_bytes() == (ROOT / file).read_bytes(), file
    goos, arch = target.split('/')
    binary = destination / ('labradorite.exe' if goos == 'windows' else 'labradorite')
    data = binary.read_bytes()
    if goos == 'windows':
        assert data[:2] == b'MZ'
        pe = struct.unpack_from('<I', data, 0x3c)[0]
        assert data[pe:pe+4] == b'PE\0\0'
        assert struct.unpack_from('<H', data, pe+4)[0] == {'amd64': 0x8664, 'arm64': 0xaa64}[arch]
    else:
        assert data[:5] == b'\x7fELF\x02'
        assert struct.unpack_from('<H', data, 18)[0] == {'amd64': 62, 'arm64': 183}[arch]
        assert binary.stat().st_mode & 0o111
    if target == host_target():
        assert subprocess.check_output([str(binary.resolve()), '-version'], text=True).strip() == f'labradorite {version}'
    print(f'PASS: {target}, {version}, {commit}, SHA256, binary architecture, guide and all licenses')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    parser.add_argument('version')
    parser.add_argument('target')
    parser.add_argument('--extract', required=True)
    args = parser.parse_args()
    verify(args.directory, args.version, args.target, args.extract)
