/*
  Publish the source of this app to the public mirror.

  What npm installs is compiled output. AGPL-3.0-only permits conveying object code only if the
  recipient can reach the Corresponding Source, and NOTICE.md names this mirror and a tag as the
  place. So the mirror is not a nicety: a published tarball whose tag is not here is a licence
  breach, and this script is what keeps the two in step.

  It refuses to mirror a tree that is not committed, for the same reason the pack refuses one:
  what cannot be reproduced cannot be the Corresponding Source of anything.

  Prepares by default and reports what would change. Pass --push to publish.
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
    '| App | npm | Source |',
    '| --- | --- | --- |',
    `| panoma video | [\`@panoma/video\`](https://www.npmjs.com/package/@panoma/video) | [\`${DIR}/\`](${DIR}) |`,
    '',
    'This repository is a mirror. What npm installs is compiled output, and the licence permits',
    'conveying that only if you can read the source it came from — so every published version is',
    'here under a tag, and `NOTICE.md` inside the package points back at it.',
    '',
    'Issues and pull requests are welcome here.',
    '',
  ].join('\n'));

  if (git(temp, 'status', '--porcelain') === '') { console.log(`The mirror already matches ${head.slice(0, 7)}. Nothing to publish.`); }
  else {
    execFileSync('git', ['add', '--all'], { cwd: temp, stdio: 'inherit' });
    const files = git(temp, 'diff', '--cached', '--stat').split('\n').at(-1) ?? '';
    execFileSync('git', ['commit', '--quiet', '-m', `panoma video ${pkg.version}`, '-m', `Mirrors ${head} of the panoma-video repository.`], { cwd: temp, stdio: 'inherit' });
    console.log(`Prepared: ${files.trim()}`);
  }
  const tagged = git(temp, 'tag', '--list', tag) !== '';
  if (!tagged) execFileSync('git', ['tag', '-a', tag, '-m', `panoma video ${pkg.version}`], { cwd: temp, stdio: 'inherit' });

  if (!push) { console.log(`Not published. Re-run with --push to publish ${tag}.`); }
  else {
    execFileSync('git', ['push', 'origin', 'HEAD'], { cwd: temp, stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', tag], { cwd: temp, stdio: 'inherit' });
    console.log(`Published ${tag} to ${MIRROR}`);
  }
} finally { await rm(temp, { recursive: true, force: true }); }
