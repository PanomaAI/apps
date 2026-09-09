/* prepack only verifies: it cannot silently build from a different checkout. */
import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const file of ['dist/panoma-video.js', 'dist/mcp.js', 'dist/runtime.json', 'assets/fonts/CREDITS.json', 'LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'npm-shrinkwrap.json', 'docs/codecs.md']) await access(join(root, file));
const lock = JSON.parse(await readFile(join(root, 'npm-shrinkwrap.json'), 'utf8'));
if (lock.name !== pkg.name || lock.version !== pkg.version || JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(pkg.dependencies)) throw new Error('The production shrinkwrap is stale. Run pnpm release:prepare.');
const runtime = JSON.parse(await readFile(join(root, 'dist/runtime.json'), 'utf8'));
if (runtime.version !== pkg.version) throw new Error('The compiled package version is stale. Run pnpm release:prepare.');
if (runtime.imports.some(name => name.startsWith('@panoma/') || name === 'typescript')) throw new Error('Unresolved development import in the runtime.');
/*
  What follows asks a different question from the three above. Those ask whether the build is
  internally consistent; these ask whether it came from this checkout. `dist/` is gitignored
  release output, so `npm publish` uploads whatever is on disk that day, wherever it came from.
  A version string compared against itself never noticed that.
 */
const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return undefined; } };
const head = git('rev-parse', 'HEAD');
if (head && runtime.commit && runtime.commit !== head) throw new Error(`The build is from another commit: dist says ${runtime.commit.slice(0, 7)}, HEAD is ${head.slice(0, 7)}. Run pnpm release:prepare.`);
const lockNow = createHash('sha256').update(await readFile(join(root, 'pnpm-lock.yaml'))).digest('hex');
if (runtime.lockfile && runtime.lockfile !== lockNow) throw new Error('The lockfile moved after the build, so the versions inside are not the ones this tree declares. Run pnpm release:prepare.');
/*
  A dirty tree is an error and not a warning: if what travels is in no commit, nobody can
  reproduce the tarball or read the source of the version they are running — which under
  AGPL-3.0-only is the one thing the licence promises. The escape hatch is for packing locally
  before committing, and it is named ugly on purpose so it cannot drift into a release.
 */
if (runtime.cleanTree === false && process.env.PANOMA_VIDEO_PACK_DIRTY !== '1') throw new Error('The build was made with uncommitted changes, so nobody can reproduce it. Commit or discard, then run pnpm release:prepare. For a local test: PANOMA_VIDEO_PACK_DIRTY=1 npm pack');
/* AGPL-3.0-only conveys object code here; the manifest is the only place the source is named. */
if (!pkg.repository?.url) throw new Error('The manifest declares no repository, so the package points nowhere at its own source.');
