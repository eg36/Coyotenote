"""Reject unsafe workflow inputs before starting Go or creating output files."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from package import package


class PackageInputs(unittest.TestCase):
    def test_unsafe_version_never_builds_or_writes(self):
        with tempfile.TemporaryDirectory() as root, patch('package.subprocess.check_output') as git:
            output = Path(root) / 'output'
            for version in ('', '../beta', '1.6.0-beta.1/escape', '1.6.0\n', '1.6.0 -X evil=value',
                            '1.6.0$(touch INJECTED)', 'v01.6.0', 'v1.06.0'):
                with self.subTest(version=version), self.assertRaises(ValueError):
                    package(version, 'windows/amd64', output)
            git.assert_not_called()
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
