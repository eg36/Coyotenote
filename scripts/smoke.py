#!/usr/bin/env python3
"""Real-terminal smoke test using only Python's standard library (Linux/macOS)."""
import fcntl
import os
import pathlib
import pty
import select
import signal
import struct
import tempfile
import termios
import time

binary = str(pathlib.Path(__file__).resolve().parents[1] / 'bin/coyotenote')

def start(directory):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ['TERM'] = 'xterm-256color'
        os.environ['COLORTERM'] = 'truecolor'
        os.environ.pop('NO_COLOR', None)
        os.execv(binary, [binary, '-data-dir', directory])
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
        if predicate(output):
            return output
    raise AssertionError('terminal or persistence check timed out: ' + repr(output[-300:]))

def reap(pid, timeout=5):
    deadline = time.monotonic()+timeout
    while time.monotonic()<deadline:
        got,status=os.waitpid(pid,os.WNOHANG)
        if got:
            assert os.waitstatus_to_exitcode(status)==0, status
            return
        time.sleep(.05)
    raise AssertionError('process did not quit')

with tempfile.TemporaryDirectory(prefix='coyotenote-smoke-') as directory:
    pid,fd=start(directory)
    try:
        wait_for(fd,lambda out:b'coyotenote' in out)
        os.write(fd,b'\x0e') # new
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
        os.write(fd,b'\x14') # light theme, including preview
        wait_for(fd,lambda out:b'light' in out)
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
        wait_for(fd,lambda out:b'Untitled' in out)
        os.write(fd,b'Flushed on termination')
        wait_for(fd,lambda out:b'Flushed' in out)
        os.kill(pid,signal.SIGTERM)
        reap(pid)
        texts=[p.read_text() for p in pathlib.Path(directory).glob('*.md')]
        assert len(texts)==2 and 'Flushed on termination' in texts, texts
    finally:
        os.close(fd)
        try: os.kill(pid,signal.SIGKILL)
        except ProcessLookupError: pass
print('PASS: real TUI create, edit, autosave, preview/split, theme/resize, SIGKILL recovery and SIGTERM flush')
