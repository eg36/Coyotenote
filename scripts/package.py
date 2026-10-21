#!/usr/bin/env python3
"""Build one target, package its docs, and checksum the immutable archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGETS = ('linux/amd64', 'linux/arm64', 'windows/amd64', 'windows/arm64')
VERSION = re.compile(r'v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?')


def host_target():
    arch = {'x86_64': 'amd64', 'amd64': 'amd64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(platform.machine().lower())
    return f'{platform.system().lower()}/{arch}'


def package(version, target, output):
    if not VERSION.fullmatch(version):
        raise ValueError('version must be a safe semantic version, such as 1.6.0-beta.1')
    if target not in TARGETS:
        raise ValueError(f'unsupported target: {target}')
    goos, goarch = target.split('/')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    executable = 'labradorite.exe' if goos == 'windows' else 'labradorite'
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    name = f'labradorite_{version}_{goos}_{goarch}'
    suffix = '.zip' if goos == 'windows' else '.tar.gz'
    archive = output / (name + suffix)
    with tempfile.TemporaryDirectory(prefix='labradorite-package-') as directory:
        stage = Path(directory)
        subprocess.run(['go', 'build', '-trimpath', '-ldflags',
                        f'-s -w -X github.com/eg36/labradorite/internal/version.Version={version}',
                        '-o', str(stage / executable), './cmd/labradorite'],
                       cwd=ROOT, env={**os.environ, 'CGO_ENABLED': '0', 'GOOS': goos, 'GOARCH': goarch}, check=True)
        if target == host_target():
            actual = subprocess.check_output([str(stage / executable), '-version'], text=True).strip()
            if actual != f'labradorite {version}':
                raise RuntimeError(f'incorrect executable version: {actual}')
        for file in ('LICENSE', 'THIRD_PARTY_NOTICES.md'):
            shutil.copyfile(ROOT / file, stage / file)
        (stage / 'docs').mkdir()
        shutil.copyfile(ROOT / 'docs/GUIDE.md', stage / 'docs/GUIDE.md')
        shutil.copytree(ROOT / 'docs/licenses', stage / 'docs/licenses')
        info = {'version': version, 'commit': commit, 'target': target}
        (stage / 'BUILDINFO.json').write_text(json.dumps(info, indent=2) + '\n', encoding='utf-8')
        if goos == 'windows':
            with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
                for file in sorted(stage.rglob('*')):
                    if file.is_file():
                        bundle.write(file, file.relative_to(stage).as_posix())
        else:
            with tarfile.open(archive, 'w:gz') as bundle:
                for file in sorted(stage.iterdir()):
                    bundle.add(file, arcname=file.name)
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    # One output directory per target avoids checksum/metadata collisions.
    (output / 'SHA256SUMS').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    (output / 'BUILDINFO.json').write_text(json.dumps(info, indent=2) + '\n', encoding='utf-8')
    print(archive)
    return archive


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version')
    parser.add_argument('--target', choices=TARGETS, default=host_target())
    parser.add_argument('--output', default=ROOT / 'dist')
    args = parser.parse_args()
    package(args.version, args.target, args.output)
