/*
  Publish the source of this app to the public mirror.

  What npm installs is compiled output. AGPL-3.0-only permits conveying object code only if the
  recipient can reach the Corresponding Source, and NOTICE.md names this mirror and a tag as the
  place. So the mirror is not a nicety: a published tarball whose tag is not here is a licence
  breach, and this script is what keeps the two in step.

  It refuses to mirror a tree that is not committed, for the same reason the pack refuses one:
  what cannot be reproduced cannot be the Corresponding Source of anything.

  Prepares by default and reports what would change. Pass --push to publish, and --retag only
  to move a tag whose version is not on npm yet.
*/
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const MIRROR = 'https://github.com/PanomaAI/apps.git';
const DIR = 'video';
const push = process.argv.includes('--push');
const retag = process.argv.includes('--retag');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const tag = `${DIR ? 'panoma-video' : pkg.name}-${pkg.version}`;

if (git(root, 'status', '--porcelain') !== '') throw new Error('The tree has uncommitted changes, so the mirror would carry source that is in no commit. Commit or discard first.');
const head = git(root, 'rev-parse', 'HEAD');

const temp = await mkdtemp(join(tmpdir(), 'panoma-apps-mirror-'));
try {
  execFileSync('git', ['clone', '--quiet', MIRROR, temp], { stdio: 'inherit' });
  const target = join(temp, DIR);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  // `git archive` gives exactly the tracked files at HEAD: no build output, no ignored files, no .git.
  execFileSync('sh', ['-c', `git -C ${JSON.stringify(root)} archive HEAD | tar -x -C ${JSON.stringify(target)}`], { stdio: 'inherit' });
  // GitHub reads the licence from the root, and every app here carries the same one.
  await cp(join(root, 'LICENSE'), join(temp, 'LICENSE'));
  await writeFile(join(temp, 'README.md'), [
    '# panoma apps',
    '',
    'The source of the official apps for [panoma](https://panoma.ai). Each app is a directory',
    'here and carries its own notices; all of them are AGPL-3.0-only, and the licence at the',
    'root is that text.',
    '',
    'Copyright (c) 2026 Jesús Castillo.',
    '',
    '| App | npm | Source |',
    '| --- | --- | --- |',
    `| panoma video | [\`@panoma/video\`](https://www.npmjs.com/package/@panoma/video) | [\`${DIR}/\`](${DIR}) |`,
    '',
    'This repository is a publication mirror. What npm installs is compiled output, and the',
    'licence permits conveying that only if you can read the source it came from — so every',
    'published version is here under a tag, and `NOTICE.md` inside the package points back at',
    'it. `panoma-video-<version>` is the exact source of `@panoma/video` at that version.',
    '',
    'Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how a',
    'change is reviewed and how it reaches a release, and a first contribution needs the',
    '[contributor agreement](CLA.md) — a licence, not an assignment; you keep your copyright.',
    'The names *panoma* and *panoma video* are not part of the licence grant:',
    '[TRADEMARK.md](TRADEMARK.md). Security reports go to [SECURITY.md](SECURITY.md), never to',
    'a public issue.',
    '',
  ].join('\n'));

  if (git(temp, 'status', '--porcelain') === '') { console.log(`The mirror already matches ${head.slice(0, 7)}. Nothing to publish.`); }
  else {
    execFileSync('git', ['add', '--all'], { cwd: temp, stdio: 'inherit' });
    const files = git(temp, 'diff', '--cached', '--stat').split('\n').at(-1) ?? '';
    execFileSync('git', ['commit', '--quiet', '-m', `panoma video ${pkg.version}`, '-m', `Mirrors ${head} of the panoma-video repository.`], { cwd: temp, stdio: 'inherit' });
    console.log(`Prepared: ${files.trim()}`);
  }
  /*
    NOTICE.md tells every recipient of the package that this tag is their source. Once a version
    is on npm the tag is a promise and must never move; before that, moving it is the only way to
    fold a late fix into the same version. The script cannot tell which case it is in, so it
    refuses to move a tag unless told, and says why.
   */
  const stale = git(temp, 'tag', '--list', tag) !== '' && git(temp, 'rev-parse', `${tag}^{commit}`) !== git(temp, 'rev-parse', 'HEAD');
  if (stale && !retag) throw new Error(`${tag} already exists on another commit. If ${pkg.version} is on npm, bump the version instead: a published tag must never move. If it is not published yet, re-run with --retag.`);
  if (stale || git(temp, 'tag', '--list', tag) === '') execFileSync('git', ['tag', '-f', '-a', tag, '-m', `panoma video ${pkg.version}`], { cwd: temp, stdio: 'inherit' });

  if (!push) { console.log(`Not published. Re-run with --push to publish ${tag}${stale ? ' (moving it)' : ''}.`); }
  else {
    execFileSync('git', ['push', 'origin', 'HEAD'], { cwd: temp, stdio: 'inherit' });
    execFileSync('git', ['push', ...(stale ? ['--force'] : []), 'origin', tag], { cwd: temp, stdio: 'inherit' });
    console.log(`Published ${tag} to ${MIRROR}`);
  }
} finally { await rm(temp, { recursive: true, force: true }); }
