#!/usr/bin/env python3
"""Prepare verified npm bytes and notes for a manually published GitHub Release."""

import argparse
import base64
import hashlib
import hmac
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request

NAME = 'dsh-open-market'
PACKAGE = Path('packages') / NAME
REGISTRY = 'https://registry.npmjs.org'
MAX_ARCHIVE = 10 * 1024 * 1024
MAX_CONTENT = 50 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def download(url, limit):
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(url, headers={'User-Agent': 'dsh-open-market-release'})
    with opener.open(request, timeout=30) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError(f'{url} exceeds the download limit')
    return content


def notes_for(changelog, version):
    heading = re.search(rf'^## {re.escape(version)}\s*$', changelog, re.MULTILINE)
    if not heading:
        raise ValueError(f'Add a ## {version} section to {PACKAGE / "CHANGELOG.md"}')
    remaining = changelog[heading.end():]
    following = re.search(r'^## ', remaining, re.MULTILINE)
    notes = remaining[:following.start() if following else None].strip()
    if not notes:
        raise ValueError(f'No update notes for {version}')
    return notes


def git(*args):
    result = subprocess.run(['git', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise ValueError(f'git {args[0]} failed: {result.stderr.decode("utf-8", "replace").strip()}')
    return result.stdout


def verify_archive(archive, commit, version):
    git('merge-base', '--is-ancestor', commit, 'HEAD')
    seen = set()
    total = 0
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as source:
        for member in source:
            if member.isdir():
                continue
            if not member.isfile() or not member.name.startswith('package/') or '\\' in member.name:
                raise ValueError(f'Unexpected archive entry: {member.name}')
            relative = member.name.removeprefix('package/')
            parts = PurePosixPath(relative).parts
            if not parts or any(part in ('.', '..') for part in relative.split('/')) or relative in seen:
                raise ValueError(f'Unsafe or duplicate archive entry: {member.name}')
            seen.add(relative)
            total += member.size
            if len(seen) > 500 or total > MAX_CONTENT:
                raise ValueError('Archive contains too many files or too much data')
            content = source.extractfile(member).read()
            tracked = git('show', f'{commit}:{PACKAGE.as_posix()}/{relative}')
            if content != tracked:
                raise ValueError(f'Published file differs from source commit: {relative}')
            if relative == 'package.json':
                manifest = json.loads(content)
                if manifest.get('name') != NAME or manifest.get('version') != version:
                    raise ValueError('Published package name or version differs from the manifest')
    if 'package.json' not in seen:
        raise ValueError('Published archive has no package.json')


def prepare(output, metadata_path=None, archive_path=None):
    manifest = json.loads((PACKAGE / 'package.json').read_text(encoding='utf-8'))
    version = manifest.get('version', '')
    if manifest.get('name') != NAME or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version):
        raise ValueError('Unexpected package name or version')
    notes = notes_for((PACKAGE / 'CHANGELOG.md').read_text(encoding='utf-8'), version)
    metadata = json.loads(Path(metadata_path).read_bytes() if metadata_path else download(f'{REGISTRY}/{NAME}/{version}', 1024 * 1024))
    if metadata.get('name') != NAME or metadata.get('version') != version:
        raise ValueError('npm metadata has an unexpected package name or version')
    commit = metadata.get('gitHead', '')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('npm metadata must include a full gitHead')
    dist = metadata.get('dist', {})
    expected_url = f'{REGISTRY}/{NAME}/-/{NAME}-{version}.tgz'
    if dist.get('tarball') != expected_url:
        raise ValueError('Unexpected npm tarball URL')
    archive = Path(archive_path).read_bytes() if archive_path else download(expected_url, MAX_ARCHIVE)
    if len(archive) > MAX_ARCHIVE:
        raise ValueError('Published archive exceeds the download limit')
    digest = 'sha512-' + base64.b64encode(hashlib.sha512(archive).digest()).decode('ascii')
    if not hmac.compare_digest(digest, dist.get('integrity', '')):
        raise ValueError('Published archive does not match npm SHA-512')
    verify_archive(archive, commit, version)

    output.mkdir(parents=True, exist_ok=True)
    asset = output / f'{NAME}-{version}.tgz'
    release_notes = output / 'release-notes.md'
    asset.write_bytes(archive)
    release_notes.write_text(f'{notes}\n\n默认安装仍使用 npm：\n\n```sh\ndsh plugin --profile desktop add {NAME}\n```\n\n附件是与 npm 相同的插件发布包，可直接下载。\n', encoding='utf-8')
    print(f'version={version}')
    print(f'tag={NAME}-v{version}')
    print(f'commit={commit}')
    print(f'asset={asset.resolve()}')
    print(f'notes={release_notes.resolve()}')
    print(f'prerelease={str("-" in version).lower()}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--metadata', help='use a saved version-specific npm metadata response')
    parser.add_argument('--archive', help='use a previously downloaded npm tarball')
    arguments = parser.parse_args()
    try:
        prepare(arguments.output, arguments.metadata, arguments.archive)
    except (OSError, ValueError, tarfile.TarError, json.JSONDecodeError) as error:
        print(f'Cannot prepare release: {error}', file=sys.stderr)
        sys.exit(1)
