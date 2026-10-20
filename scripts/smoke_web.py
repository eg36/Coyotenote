#!/usr/bin/env python3
"""Dependency-free HTTP/persistence smoke check for the embedded Go web app."""
import json
import os
import pathlib
import signal
import subprocess
import tempfile
import urllib.error
import urllib.request

# Actions may start Python without a console. Give the Windows child a shared
# console so CTRL_BREAK can exercise Go's graceful interrupt handler. A
# pseudo-console has no window, so ask whether any process is attached.
if os.name == 'nt':
    import ctypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    if not kernel.GetConsoleProcessList((ctypes.c_ulong * 1)(), 1) and not kernel.AllocConsole():
        raise ctypes.WinError(ctypes.get_last_error())

BINARY = os.environ.get('LABRADORITE_BINARY', str(pathlib.Path(__file__).resolve().parents[1] / 'bin' / ('labradorite.exe' if os.name == 'nt' else 'labradorite')))

def start(vault):
    process = subprocess.Popen([BINARY, '-no-browser', '-listen', '127.0.0.1:0', '-data-dir', vault], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
    first = process.stdout.readline()
    address = process.stdout.readline()
    assert first.startswith('labradorite '), first
    assert address.startswith('Open http://'), address
    base = address.strip().removeprefix('Open ')
    return process, base

def call(base, route, method='GET', body=None, token=None):
    headers = {'Origin': base}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if token:
        headers['X-Labradorite-Token'] = token
    request = urllib.request.Request(base + route, data=None if body is None else json.dumps(body).encode(), method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)

def stop(process):
    if os.name == 'nt':
        process.send_signal(signal.CTRL_BREAK_EVENT)
    else:
        process.terminate()
    out, error = process.communicate(timeout=10)
    assert process.returncode == 0, (process.returncode, out, error)

version=subprocess.run([BINARY,'-version'],capture_output=True,text=True,check=True).stdout
assert version.startswith('labradorite '), version

with tempfile.TemporaryDirectory(prefix='labradorite-http-smoke-') as directory:
    directory = str(pathlib.Path(directory) / 'Vault with spaces — 笔记')
    pathlib.Path(directory).mkdir()
    process, base = start(directory)
    try:
        state = call(base, '/api/state')
        assert len(state['themes']) == 14
        assert state['notes'] == []
        token = state['token']
        note = call(base, '/api/note', 'POST', {'id': 'Work/Smoke', 'body': '# A thought\n\n**Keep it.**'}, token)
        note = call(base, '/api/note', 'PUT', {'id': note['id'], 'body': '# A thought\n\nSaved for tomorrow.\n', 'revision': note['revision']}, token)
        assert pathlib.Path(directory, 'Work', 'Smoke.md').read_text() == note['body']
        rendered = call(base, '/api/render', 'POST', {'body': '# Heading\n\n**bold**', 'id': note['id']}, token)
        assert '<strong>bold</strong>' in rendered['html']
        call(base, '/api/settings', 'POST', {'theme': 'tokyo-night'}, token)
        call(base, '/api/note', 'DELETE', {'id': note['id'], 'revision': note['revision']}, token)
        note = call(base, '/api/restore', 'POST', {'id': note['id']}, token)
        assert 'Saved for tomorrow.' in note['body']
        try:
            call(base, '/api/note', 'PUT', {'id': note['id'], 'body': 'stale', 'revision': 'wrong'}, token)
            raise AssertionError('stale revision was accepted')
        except urllib.error.HTTPError as error:
            assert error.code == 409
        # The response acknowledged the durable save before an abnormal exit.
        process.kill()
        process.communicate(timeout=10)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)
    process, base = start(directory)
    try:
        state = call(base, '/api/state')
        assert state['theme'] == 'tokyo-night'
        note = call(base, '/api/note?id=Work%2FSmoke')
        assert note['body'] == '# A thought\n\nSaved for tomorrow.\n'
    finally:
        stop(process)
print('PASS: HTTP app, 14 themes, Markdown rendering, durable save, trash/restore, conflict and restart recovery')
