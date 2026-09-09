/* Build the production dependency lock in a clean directory, never in the workspace. */
import { mkdtemp, readFile, writeFile, rm, cp, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const temp = await mkdtemp(join(tmpdir(), 'panoma-video-release-'));
try {
  const production = { name: manifest.name, version: manifest.version, license: manifest.license, engines: manifest.engines, dependencies: manifest.dependencies };
  await writeFile(join(temp, 'package.json'), JSON.stringify(production, null, 2));
  const candidates = [process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath : '', join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  let npm;
  for (const file of candidates.filter(Boolean)) if (await access(file).then(() => true, () => false)) { npm = file; break; }
  if (!npm) throw new Error('npm-cli.js must be installed beside Node to prepare a release.');
  execFileSync(process.execPath, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', '--cache', join(temp, 'cache')], { cwd: temp, stdio: 'inherit', timeout: 180_000 });
  await cp(join(temp, 'package-lock.json'), join(root, 'npm-shrinkwrap.json'));
  const lock = JSON.parse(await readFile(join(temp, 'package-lock.json'), 'utf8'));
  const notices = ['# Third-party notices', '', 'Runtime dependencies resolved by npm-shrinkwrap.json. Workspace code is AGPL-3.0-only; dependencies retain the following notices. The browser and ffmpeg are installed separately.', ''];
  /* Keyed by name and version: content-type 1.0.5 and 2.1.0 are different packages and both must survive. */
  const seen = new Set();
  for (const [path, locked] of Object.entries(lock.packages).sort()) {
    if (!path) continue;
    const dir = join(temp, path);
    let pkg;
    try { pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')); } catch { continue; }
    const key = `${pkg.name}@${locked.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notices.push(`## ${pkg.name} ${locked.version}`, '', `License: ${pkg.license ?? 'see package license'}.`, '');
    for (const name of (await readdir(dir)).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name))) {
      try { notices.push(`### ${name}`, '', await readFile(join(dir, name), 'utf8'), ''); } catch { /* A directory is not a notice. */ }
    }
  }
  /*
    The loop above walks npm dependencies, so it is blind by construction to code ported into this
    tree. Those ports are declared in the source comments and the compiler strips every one of them,
    which left MIT-licensed work travelling in dist with no notice attached. The MIT licence
    conditions redistribution on exactly that notice, so it is written here by hand.
   */
  notices.push('## Ported source', '',
    'Code below was ported into this tree rather than installed from a registry. The compiled output',
    'carries no comments, so the attributions live here.', '',
    '### OpenScreen', '',
    'apps/render/src/recipes/motion.ts ports src/lib/zoomMath/zoomRegionUtils.ts, constants.ts and',
    'src/lib/cursor/cursorPathSmoothing.ts from OpenScreen (https://github.com/getopenscreen/openscreen).', '',
    'Copyright (c) 2025 Siddharth Vaddem', 'Copyright (c) 2025-2026 OpenScreen contributors', '',
    'MIT License.', '', MIT, '',
    '### dembrandt', '',
    'packages/brand/src/color.ts, roles.ts, census.ts, logo-score.ts and live-page.ts port',
    'lib/extractors/colors.ts, logo.ts and logo-heuristics.ts from dembrandt.', '',
    'Copyright (c) 2025 thevangelist.', '',
    'MIT License.', '', MIT, '',
    '### Cap', '',
    'apps/render/src/recipes/motion.ts ports crates/rendering/src/spring_mass_damper.rs,',
    'cursor_interpolation.rs and layers/keyboard.rs from Cap (https://github.com/CapSoftware/Cap).', '',
    'Copyright (c) Cap Software, Inc. AGPL-3.0, the same licence as this work; its full text is in',
    'LICENSE beside this file.', '',
    '### auto-editor', '',
    "apps/render/src/recipes/motion.ts ports auto-editor's chunk and margin model. Unlicense (public",
    'domain dedication); no conditions attach.', '',
  );
  notices.push('## Bundled fonts', '', 'The files in assets/fonts are SIL Open Font License 1.1. Their original license texts and attribution are included beside them in CREDITS.json and the named license files.', '');
  await writeFile(join(root, 'THIRD-PARTY-NOTICES.md'), notices.join('\n'));
} finally { await rm(temp, { recursive: true, force: true }); }
