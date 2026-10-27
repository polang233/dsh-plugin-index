import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('market_release', 'scripts/prepare-open-market-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class PrepareReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.package = self.root / 'package-source'
        self.package.mkdir()
        self.manifest = b'{"name":"dsh-open-market","version":"1.2.3"}'
        (self.package / 'package.json').write_bytes(self.manifest)
        (self.package / 'CHANGELOG.md').write_text('## 1.2.3\n\n- Update.\n', encoding='utf-8')
        self.package_patch = patch.object(release, 'PACKAGE', self.package)
        self.package_patch.start()
        self.addCleanup(self.package_patch.stop)
        self.git_patch = patch.object(release, 'git', side_effect=self.fake_git)
        self.git_patch.start()
        self.addCleanup(self.git_patch.stop)

    def fake_git(self, *args):
        if args[0] == 'merge-base':
            return b''
        if args[0] == 'show' and args[1].endswith('/package.json'):
            return self.manifest
        if args[0] == 'show' and args[1].endswith('/index.js'):
            return b'original source'
        raise AssertionError(args)

    def make_archive(self, code=b'original source', extra=None):
        result = io.BytesIO()
        with tarfile.open(fileobj=result, mode='w:gz') as archive:
            for name, content in [('package/package.json', self.manifest), ('package/index.js', code), *(extra or [])]:
                info = tarfile.TarInfo(name)
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
        return result.getvalue()

    def inputs(self, archive):
        metadata = {
            'name': 'dsh-open-market', 'version': '1.2.3', 'gitHead': 'a' * 40,
            'dist': {
                'tarball': 'https://registry.npmjs.org/dsh-open-market/-/dsh-open-market-1.2.3.tgz',
                'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(archive).digest()).decode(),
            },
        }
        metadata_path = self.root / 'metadata.json'
        archive_path = self.root / 'package.tgz'
        metadata_path.write_text(json.dumps(metadata), encoding='utf-8')
        archive_path.write_bytes(archive)
        return metadata_path, archive_path

    def test_prepares_verified_npm_bytes_and_notes(self):
        archive = self.make_archive()
        metadata, source = self.inputs(archive)
        output = self.root / 'output'
        with contextlib.redirect_stdout(io.StringIO()):
            release.prepare(output, metadata, source)
        self.assertEqual((output / 'dsh-open-market-1.2.3.tgz').read_bytes(), archive)
        self.assertIn('- Update.', (output / 'release-notes.md').read_text(encoding='utf-8'))

    def test_rejects_archive_that_no_longer_matches_npm(self):
        metadata, source = self.inputs(self.make_archive())
        source.write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'SHA-512'):
            release.prepare(self.root / 'output', metadata, source)
        self.assertFalse((self.root / 'output').exists())

    def test_rejects_published_content_that_differs_from_commit(self):
        metadata, source = self.inputs(self.make_archive(code=b'different release bytes'))
        with self.assertRaisesRegex(ValueError, 'differs from source commit'):
            release.prepare(self.root / 'output', metadata, source)
        self.assertFalse((self.root / 'output').exists())

    def test_rejects_path_traversal(self):
        metadata, source = self.inputs(self.make_archive(extra=[('package/../outside', b'bad')]))
        with self.assertRaisesRegex(ValueError, 'Unsafe or duplicate'):
            release.prepare(self.root / 'output', metadata, source)


if __name__ == '__main__':
    unittest.main()
