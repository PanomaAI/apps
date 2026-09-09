/*
  The brand as the repository declares it, with no browser and no server. This pass
  exists because the live pass has two failure modes the repo pass does not: the dev
  server may not start, and what it serves may be an older build than the code about
  to be filmed. Source is the truth panoma video is making a video about, so a `--primary` in
  globals.css, a `theme_color` in the manifest and a `public/logo.svg` are read here
  first and outrank anything measured from pixels (see `mergeBrand`).

  What it reads, and why those files: `globals.css` / `tokens.css` / `theme.css` /
  `app.css` are where shadcn, Tailwind v4 and most hand-rolled themes keep their
  custom properties; `tailwind.config.*` is the v3 palette; `manifest.json` /
  `site.webmanifest` carry theme and background colours and the app icons; logo files
  are named like logo files, and a README that shows one is the strongest vote for
  which. The README's first 400 words after the title are the tone sample.
*/
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { normalizeHex } from "./color.ts";
import { isDark } from "./contrast.ts";
import { defaultType, pickFont } from "./fonts.ts";
import { logoKind } from "./logo-score.ts";
import { defaultColors, selectRoles } from "./roles.ts";
import { colorTokens, roleToken, tokensFromCss, tokensFromTailwindConfig, type TokenSets } from "./tokens.ts";
import { toneOf } from "./tone.ts";
import type { BrandLogo, BrandProfile } from "./types.ts";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", ".svelte-kit", "out", "coverage", "media", "vendor", ".turbo", ".cache", "target", ".panoma", ".vira"]);
const MAX_DEPTH = 6;
const CSS_NAMES = /^(globals|tokens|theme|app)\.css$/i;
const TAILWIND_CONFIG = /^tailwind\.config\.(js|ts|cjs|mjs)$/i;
const MANIFEST_NAMES = /^(manifest\.json|site\.webmanifest|manifest\.webmanifest|app\.webmanifest)$/i;
const LOGO_DIRS = new Set(["public", "static", "assets", "docs", ".github", "brand", "art", "images", "img"]);
const LOGO_FILE = /(logo|icon|mark|wordmark|brand)[^/]*\.(svg|png)$/i;

type Found = { css: string[]; tailwind: string[]; manifests: string[]; logos: string[]; readme?: string };

function walk(root: string): Found {
  const found: Found = { css: [], tailwind: [], manifests: [], logos: [] };
  const visit = (dir: string, depth: number): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const path = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (IGNORED_DIRS.has(name) || depth >= MAX_DEPTH) continue;
        visit(path, depth + 1);
        continue;
      }
      if (depth === 0 && /^readme\.md$/i.test(name)) found.readme = path;
      if (CSS_NAMES.test(name)) found.css.push(path);
      else if (TAILWIND_CONFIG.test(name)) found.tailwind.push(path);
      else if (MANIFEST_NAMES.test(name)) found.manifests.push(path);
      else if (LOGO_FILE.test(name)) {
        const segments = relative(root, dir).split(sep);
        if (segments.some((s) => LOGO_DIRS.has(s))) found.logos.push(path);
      }
    }
  };
  visit(root, 0);
  const byDepth = (a: string, b: string): number => a.split(sep).length - b.split(sep).length || a.localeCompare(b);
  found.css.sort(byDepth);
  found.tailwind.sort(byDepth);
  found.manifests.sort(byDepth);
  found.logos.sort(byDepth);
  return found;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Shallower files win: merge deepest first so the root stylesheet has the last word. */
function mergedTokens(cssFiles: string[], tailwindFiles: string[]): TokenSets {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  let rootColorScheme: string | undefined;
  for (const file of [...tailwindFiles].reverse()) Object.assign(light, tokensFromTailwindConfig(readText(file)));
  for (const file of [...cssFiles].reverse()) {
    const sets = tokensFromCss(readText(file));
    Object.assign(light, sets.light);
    Object.assign(dark, sets.dark);
    if (sets.rootColorScheme) rootColorScheme = sets.rootColorScheme;
  }
  const out: TokenSets = { light, dark };
  if (rootColorScheme) out.rootColorScheme = rootColorScheme;
  return out;
}

type Manifest = { theme?: string; background?: string; name?: string; icons: { src: string; sizes?: string; purpose?: string }[] };

function readManifest(path: string): Manifest | null {
  try {
    const json = JSON.parse(readText(path)) as Record<string, unknown>;
    const icons = Array.isArray(json.icons) ? (json.icons as Manifest["icons"]).filter((i) => i && typeof i.src === "string") : [];
    const m: Manifest = { icons };
    const theme = normalizeHex(typeof json.theme_color === "string" ? json.theme_color : undefined);
    const background = normalizeHex(typeof json.background_color === "string" ? json.background_color : undefined);
    if (theme) m.theme = theme;
    if (background) m.background = background;
    if (typeof json.name === "string" && json.name.trim()) m.name = json.name.trim();
    else if (typeof json.short_name === "string" && json.short_name.trim()) m.name = json.short_name.trim();
    return m;
  } catch {
    return null;
  }
}

/** Intrinsic size of an SVG file from its viewBox or width/height attributes. */
export function svgSize(svg: string): { width: number; height: number } {
  const open = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const vb = open.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
  const w = open.match(/\swidth\s*=\s*["']([\d.]+)/i);
  const h = open.match(/\sheight\s*=\s*["']([\d.]+)/i);
  return { width: w ? Number(w[1]) : 0, height: h ? Number(h[1]) : 0 };
}

/** Width and height from a PNG's IHDR chunk (bytes 16–23 of the file, PNG spec §11.2.2). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const sig = [0x89, 0x50, 0x4e, 0x47];
  if (bytes.length < 24 || !sig.every((b, i) => bytes[i] === b)) return { width: 0, height: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const VARIANT_WORDS = /(dark|white|inverse|inverted|reversed|light|on-dark|on-black)/i;

/*
  Repository-side logo scoring, on the same 0–150 scale as the live pass so the merge
  can compare them. The words are the evidence: a file called wordmark IS the wordmark;
  a README that shows a file is the maintainer pointing at it; "favicon", "banner",
  "social" and a 512x512 in the name mean something else.
 */
export function scoreLogoFile(path: string, root: string, readmeRefs: Set<string>): number {
  const name = basename(path).toLowerCase();
  const rel = relative(root, path).split(sep);
  let score = 0;
  if (name.includes("wordmark")) score += 45;
  else if (name.includes("logo")) score += 40;
  else if (name.includes("brand")) score += 25;
  else if (/\bmark\b|logomark|-mark|_mark|mark\./.test(name)) score += 20;
  else if (name.includes("icon")) score += 10;
  if (name.includes("favicon")) score -= 25;
  if (name.includes("apple-touch")) score -= 20;
  if (/(banner|social|og-|opengraph|cover|hero|screenshot)/.test(name)) score -= 30;
  if (/\d{2,4}x\d{2,4}|\b(192|256|512)\b/.test(name)) score -= 10;
  if (name.endsWith(".svg")) score += 15;
  else score += 5;
  if (rel.includes("brand")) score += 15;
  if (rel.includes("public") || rel.includes("static")) score += 10;
  if (rel.includes("docs") || rel.includes("assets")) score += 5;
  if (readmeRefs.has(name)) score += 40;
  if (VARIANT_WORDS.test(name)) score -= 5;
  /* A depth penalty keeps `public/logo.svg` ahead of `apps/x/public/logo.svg`. */
  score -= Math.max(0, rel.length - 2);
  return score;
}

function readmeImageRefs(readme: string): Set<string> {
  const refs = new Set<string>();
  for (const m of readme.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)) refs.add(basename(m[1]).toLowerCase());
  for (const m of readme.matchAll(/<img[^>]*\ssrc\s*=\s*["']([^"']+)/gi)) refs.add(basename(m[1]).toLowerCase());
  return refs;
}

function repoLogo(root: string, files: string[], readme: string, manifests: Manifest[], manifestPaths: string[]): BrandLogo | undefined {
  const refs = readmeImageRefs(readme);
  const scored = files.map((file) => ({ file, score: scoreLogoFile(file, root, refs) }));
  /* Manifest icons are candidates too, at the live pass's fixed head score. */
  manifests.forEach((m, k) => {
    const dir = resolve(manifestPaths[k], "..");
    for (const icon of m.icons) {
      if (/^(https?:)?\/\//.test(icon.src)) continue;
      const file = resolve(dir, icon.src.replace(/^\//, ""));
      try {
        statSync(file);
      } catch {
        continue;
      }
      if (!scored.some((s) => s.file === file)) scored.push({ file, score: 25 + (file.endsWith(".svg") ? 10 : 0) });
    }
  });
  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const best = scored[0];
  if (!best) return undefined;
  const name = basename(best.file).toLowerCase();
  const size = best.file.toLowerCase().endsWith(".svg") ? svgSize(readText(best.file)) : pngSize(readFileSync(best.file));
  const rect = { top: 0, left: 0, width: size.width, height: size.height };
  let kind = logoKind({ source: "img", context: "header", alt: "", rect, natural: size });
  if (name.includes("wordmark")) kind = "wordmark";
  else if (/favicon|icon/.test(name) && !name.includes("logo")) kind = "icon";
  return {
    file: best.file,
    kind,
    width: size.width,
    height: size.height,
    reversed: VARIANT_WORDS.test(name) && !/light|white-bg|on-white/.test(name) ? true : false,
    origin: `repo:${relative(root, best.file).split(sep).join("/")}`,
    score: best.score,
  };
}

export async function brandFromRepo(root: string): Promise<Partial<BrandProfile>> {
  const dir = resolve(root);
  if (!statSync(dir).isDirectory()) throw new Error(`brandFromRepo: not a directory: ${dir}`);
  const found = walk(dir);

  let name: string | undefined;
  try {
    const pkg = JSON.parse(readText(join(dir, "package.json"))) as { name?: string; displayName?: string };
    name = (pkg.displayName ?? pkg.name ?? "").replace(/^@[^/]+\//, "").trim() || undefined;
  } catch {
    /* no package.json: the directory name is the last resort, set below */
  }

  const tokens = mergedTokens(found.css, found.tailwind);
  const manifestPaths = found.manifests;
  const manifests = manifestPaths.map(readManifest).filter((m): m is Manifest => m !== null);
  const manifest = manifests[0];
  if (!name && manifest?.name) name = manifest.name;
  if (!name) name = basename(dir);

  const readme = found.readme ? readText(found.readme) : "";
  const colors = selectRoles(null, {
    tokens: tokens.light,
    ...(manifest?.theme ? { manifestTheme: manifest.theme } : {}),
    ...(manifest?.background ? { manifestBackground: manifest.background } : {}),
  });

  const hasLight = Object.keys(tokens.light).length > 0;
  const hasDark = Object.keys(tokens.dark).length > 0 || /dark/i.test(tokens.rootColorScheme ?? "");
  const supports: ("light" | "dark")[] = [];
  const darkFirst = /^dark\b/i.test(tokens.rootColorScheme ?? "") || (!hasLight && hasDark) || (colors.background.confidence !== "low" && isDark(colors.background.hex));
  if (hasLight || !hasDark || /light/i.test(tokens.rootColorScheme ?? "")) supports.push("light");
  if (hasDark || darkFirst) supports.push("dark");
  const scheme: BrandProfile["scheme"] = { supports: supports.length ? supports : ["light"], default: darkFirst ? "dark" : "light" };
  if (!scheme.supports.includes(scheme.default)) scheme.supports.push(scheme.default);

  const type = defaultType();
  const sans = roleToken(tokens.light, "fontSans");
  const heading = roleToken(tokens.light, "fontHeading");
  const mono = roleToken(tokens.light, "fontMono");
  if (sans) type.body = pickFont(sans.value, "body", `css-token:${sans.name}`);
  if (heading) type.heading = pickFont(heading.value, "heading", `css-token:${heading.name}`);
  else if (sans) type.heading = pickFont(sans.value, "heading", `css-token:${sans.name}`);
  if (mono) type.mono = pickFont(mono.value, "mono", `css-token:${mono.name}`);

  const profile: Partial<BrandProfile> = {
    source: { repoPath: dir, extractedAt: new Date().toISOString() },
    name,
    colors: hasLight || manifest ? colors : defaultColors(),
    tokens: colorTokens(tokens.light),
    scheme,
    type,
    tone: readme ? toneOf(readme) : { register: "neutral", metrics: {} },
  };
  const logo = repoLogo(dir, found.logos, readme, manifests, manifestPaths);
  if (logo) profile.logo = logo;
  return profile;
}
