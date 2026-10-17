#!/usr/bin/env python3
"""Real-terminal smoke test using only Python's standard library (Linux only)."""
import fcntl
import os
import pathlib
import pty
import re
import select
import signal
import struct
import tempfile
import termios
import time

binary = str(pathlib.Path(__file__).resolve().parents[1] / 'bin/coyotenote')

def start(directory, vault_argument=False, clipboard_tools=None):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ['TERM'] = 'xterm-256color'
        os.environ['COLORTERM'] = 'truecolor'
        os.environ.pop('NO_COLOR', None)
        # Keep settings such as the theme away from the real data directory.
        os.environ['XDG_DATA_HOME'] = os.path.join(directory, '.xdg')
        if clipboard_tools:
            os.environ['WAYLAND_DISPLAY'] = 'coyotenote-test'
            os.environ['PATH'] = str(clipboard_tools) + os.pathsep + os.environ['PATH']
            os.environ['COYOTENOTE_TEST_CLIPBOARD'] = os.path.join(directory, '.clipboard')
            os.environ.pop('SSH_CONNECTION', None)
            os.environ.pop('SSH_TTY', None)
        args = [binary, directory] if vault_argument else [binary, '-data-dir', directory]
        os.execv(binary, args)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
    return pid, fd

def wait_for(fd, predicate, timeout=8):
    output = b''
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if select.select([fd], [], [], .05)[0]:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                chunk = b''
            output += chunk
            if b'\x1b]11;' in chunk:
                os.write(fd, b'\x1b]11;rgb:1111/1111/1111\x1b\\')
            if b'\x1b[6n' in chunk:
                os.write(fd, b'\x1b[1;1R')
        # Match on visible text: gradients put color codes between letters.
        if predicate(re.sub(rb'\x1b\[[0-9;:?]*[A-Za-z]', b'', output)):
            return output
    raise AssertionError('terminal or persistence check timed out: ' + repr(output[-300:]))

def reap(pid, fd, timeout=5):
    deadline = time.monotonic()+timeout
    while time.monotonic()<deadline:
        # Keep draining the PTY: a full buffer blocks the app's exit output.
        try:
            if select.select([fd],[],[],0)[0]:
                os.read(fd,65536)
        except OSError:
            pass
        got,status=os.waitpid(pid,os.WNOHANG)
        if got:
            assert os.waitstatus_to_exitcode(status)==0, status
            return
        time.sleep(.05)
    raise AssertionError('process did not quit')

import subprocess
out=subprocess.run([binary,'-version'],capture_output=True,text=True,check=True).stdout
assert out.startswith('coyotenote '), out

with tempfile.TemporaryDirectory(prefix='coyotenote-smoke-') as directory:
    pid,fd=start(directory)
    try:
        wait_for(fd,lambda out:b'coyotenote' in out)
        os.write(fd,b'\x0e') # new: name prompt
        wait_for(fd,lambda out:b'NEW NOTE' in out)
        os.write(fd,b'\r')
        wait_for(fd,lambda out:b'Untitled' in out)
        os.write(fd,b'# Persistent thought\r\r**markdown** survives a crash')
        def saved(_):
            files=list(pathlib.Path(directory).glob('*.md'))
            return len(files)==1 and 'survives a crash' in files[0].read_text()
        wait_for(fd,saved)
        os.write(fd,b'\x10') # preview
        wait_for(fd,lambda out:b'PREVIEW' in out)
        os.write(fd,b'\x10') # split
        wait_for(fd,lambda out:b'SPLIT' in out)
        os.write(fd,b'\x14') # searchable theme chooser
        wait_for(fd,lambda out:b'THEMES' in out)
        os.write(fd,b'catppuccin mocha\r')
        wait_for(fd,lambda out:b'catppuccin-mocha' in out)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 15, 40, 0, 0))
        os.kill(pid,signal.SIGWINCH)
        wait_for(fd,lambda out:b'split at 90+' in out and b'F1' in out)
        os.kill(pid,signal.SIGKILL)
        os.waitpid(pid,0)
    finally:
        os.close(fd)
        try: os.kill(pid,signal.SIGKILL)
        except ProcessLookupError: pass
    pid,fd=start(directory)
    try:
        wait_for(fd,lambda out:b'Persistent thought' in out)
        os.write(fd,b'\x0e')
        wait_for(fd,lambda out:b'NEW NOTE' in out)
        os.write(fd,b'\r')
        wait_for(fd,lambda out:b'Untitled 2' in out)
        os.write(fd,b'Flushed on termination')
        wait_for(fd,lambda out:b'termination' in out)
        os.kill(pid,signal.SIGTERM)
        reap(pid,fd)
        texts=[p.read_text() for p in pathlib.Path(directory).glob('*.md')]
        assert len(texts)==2 and 'Flushed on termination' in texts, texts
    finally:
        os.close(fd)
        try: os.kill(pid,signal.SIGKILL)
        except ProcessLookupError: pass
with tempfile.TemporaryDirectory(prefix='coyotenote-vault-') as directory:
    vault=pathlib.Path(directory)
    pid,fd=start(directory, vault_argument=True)
    def has(path, text):
        return lambda _: (vault/path).exists() and text in (vault/path).read_text()
    try:
        wait_for(fd,lambda out:b'coyotenote' in out)
        os.write(fd,b'\x0e')
        wait_for(fd,lambda out:b'NEW NOTE' in out)
        os.write(fd,b'Folder/A\r')
        wait_for(fd,lambda out:b'Folder/A' in out)
        os.write(fd,b'Alpha body')
        wait_for(fd,has('Folder/A.md','Alpha body'))
        os.write(fd,b'\x0e')
        wait_for(fd,lambda out:b'NEW NOTE' in out)
        os.write(fd,b'\x15B\r') # Ctrl+U clears the "Folder/" prefix
        wait_for(fd,has('B.md',''))
        os.write(fd,b'see [[')
        wait_for(fd,lambda out:b'Tab' in out)
        os.write(fd,b'\t')
        wait_for(fd,has('B.md','see [[A]]'))
        os.write(fd,b'\x02\x02\x07') # cursor into the link, Ctrl+G
        wait_for(fd,lambda out:b'Alpha body' in out)
        os.write(fd,b'\x0c') # Ctrl+L: backlinks
        wait_for(fd,lambda out:b'LINKS HERE' in out)
        os.write(fd,b'\x1b')
        time.sleep(.2)
        os.write(fd,b'\x12') # Ctrl+R
        wait_for(fd,lambda out:b'RENAME' in out)
        os.write(fd,b'2\r')
        wait_for(fd,has('B.md','see [[A2]]'))
        assert (vault/'Folder/A2.md').read_text()=='Alpha body'
        assert not (vault/'theme').exists()
        os.write(fd,b'\x19') # Ctrl+Y back to B
        wait_for(fd,lambda out:b'see [[A2]]' in out)
        os.write(fd,b'\x11')
        reap(pid,fd)
    finally:
        os.close(fd)
        try: os.kill(pid,signal.SIGKILL)
        except ProcessLookupError: pass
with tempfile.TemporaryDirectory(prefix='coyotenote-clipboard-') as directory:
    vault = pathlib.Path(directory)
    tools = vault/'.tools'
    tools.mkdir()
    for name, body in {'wl-copy': 'cat > "$COYOTENOTE_TEST_CLIPBOARD"',
                       'wl-paste': 'cat "$COYOTENOTE_TEST_CLIPBOARD"'}.items():
        helper = tools/name
        helper.write_text('#!/bin/sh\n'+body+'\n')
        helper.chmod(0o700)
    (vault/'Selection.md').write_text('alpha beta')
    pid,fd=start(directory, clipboard_tools=tools)
    try:
        wait_for(fd,lambda out:b'alpha beta' in out)
        os.write(fd,b'\x1b[1;2C'*5) # Shift+Right selects alpha
        wait_for(fd,lambda out:b'5 selected' in out)
        os.write(fd,b'\x03') # Ctrl+C copies rather than quitting
        wait_for(fd,lambda _: (vault/'.clipboard').exists() and (vault/'.clipboard').read_text()=='alpha')
        os.write(fd,b'\x18') # Ctrl+X cuts only after the helper succeeds
        wait_for(fd,lambda _: (vault/'Selection.md').read_text()==' beta')
        os.write(fd,b'\x16') # Ctrl+V uses our own validated clipboard result
        wait_for(fd,lambda _: (vault/'Selection.md').read_text()=='alpha beta')
        os.write(fd,b'\x01') # home
        os.write(fd,b'\x1b[1;2C'*5)
        wait_for(fd,lambda out:b'5 selected' in out)
        os.write(fd,b'\x1b[200~new\r\ntext\x1b[201~') # bracketed paste replaces selection
        wait_for(fd,lambda _: (vault/'Selection.md').read_text()=='new\ntext beta')
        os.write(fd,b'\x11')
        reap(pid,fd)
    finally:
        os.close(fd)
        try: os.kill(pid,signal.SIGKILL)
        except ProcessLookupError: pass
print('PASS: TUI autosave, recovery, preview/split, themes, folders, wiki links, Shift selection, copy/cut/paste and bracketed replacement')
