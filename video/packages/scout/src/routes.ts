/*
  Static route discovery: the screens a project has, read from its file conventions
  before any server is started. A tour that walks a site needs a seed list, and a
  video that says "the docs page" needs a fact that the route exists. Every
  framework here publishes its routing as a directory convention, so the list costs
  a directory walk and no browser.

  Sources, one per globber:
  - Next.js: a segment is public only when page.* exists; [slug], [...slug] and
    [[...slug]] are dynamic; (group) is stripped from the URL; _folder is private;
    @slot is parallel; (.)folder intercepts; src/ is optional; pages/ is the legacy
    router. A production build writes .next/app-path-routes-manifest.json.
    https://nextjs.org/docs/app/getting-started/project-structure
  - SvelteKit: every +page.svelte under src/routes, with [param], [...rest], [[optional]] and (group).
    https://svelte.dev/docs/kit/routing
  - Nuxt: pages/** (index.vue, [id].vue, [...slug].vue); an app.vue-only app has one route.
    https://nuxt.com/docs/guide/directory-structure/pages
  - Astro: every .astro/.md/.mdx/.html under src/pages; [param] and [...rest]; _prefix is ignored.
    https://docs.astro.build/en/guides/routing/
  - TanStack Router: routes/** with __root, index, $param, _layout (pathless) and dot
    nesting; routeTree.gen.ts is the generated truth when it exists.
    https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing
  - React Router (framework mode): app/routes.ts with route()/index()/prefix(), or
    flatRoutes() over app/routes/ ( _index, dot nesting, $param, _layout prefix ).
    https://reactrouter.com/start/framework/routing · https://reactrouter.com/how-to/file-route-conventions

  Static routes come first — a tour can open them without inventing an id — and the
  list is capped at 20 because a camera cannot visit more and a fact sheet with 400
  routes is noise.
*/
import { join } from "node:path";
import { exists, isDir, readJson, readText, walk } from "./fs.ts";
import type { Route } from "./types.ts";

export const ROUTE_CAP = 20;

const PAGE_EXT = /\.(js|jsx|ts|tsx|md|mdx)$/;

/** Segments that never reach the URL: (group), (.)intercept, @slot. Private _dirs make the whole route private. */
function nextSegments(rel: string): string[] | undefined {
  const out: string[] = [];
  for (const seg of rel.split("/")) {
    if (seg === "" ) continue;
    if (seg.startsWith("_")) return undefined;
    if (seg.startsWith("@")) continue;
    if (/^\(\.{1,3}\)/.test(seg) || /^\(\.\.\)\(\.\.\)/.test(seg)) return undefined;
    if (seg.startsWith("(") && seg.endsWith(")")) continue;
    out.push(seg);
  }
  return out;
}

const isDynamicSeg = (seg: string) => /^\[.*\]$|^\$|^:/.test(seg) || seg.startsWith("[");

function toRoute(segments: string[], source: string): Route {
  const path = "/" + segments.join("/");
  return { path: path === "/" ? "/" : path.replace(/\/+$/, ""), dynamic: segments.some(isDynamicSeg), source };
}

function nextRoutes(root: string): Route[] {
  const manifest = join(root, ".next", "app-path-routes-manifest.json");
  const built = readJson<Record<string, string>>(manifest);
  if (built) {
    return Object.entries(built)
      .filter(([k]) => k.endsWith("/page"))
      .map(([, path]) => ({ path, dynamic: /\[.*\]/.test(path), source: ".next/app-path-routes-manifest.json" }));
  }
  const out: Route[] = [];
  const appDir = ["app", "src/app"].find((d) => isDir(join(root, d)));
  if (appDir) {
    for (const f of walk(join(root, appDir), { maxFiles: 2000 })) {
      const m = /(^|\/)page\.(js|jsx|ts|tsx|md|mdx)$/.exec(f);
      if (!m) continue;
      const segs = nextSegments(f.slice(0, f.length - m[0].length));
      if (segs) out.push(toRoute(segs, `${appDir}/${f}`));
    }
  }
  const pagesDir = ["pages", "src/pages"].find((d) => isDir(join(root, d)));
  if (pagesDir && !out.length) {
    for (const f of walk(join(root, pagesDir), { maxFiles: 2000 })) {
      if (!PAGE_EXT.test(f) || f.startsWith("api/") || /^_app\.|^_document\.|^_error\.|^404\.|^500\./.test(f)) continue;
      const segs = f.replace(PAGE_EXT, "").split("/").filter((s) => s !== "index");
      out.push(toRoute(segs, `${pagesDir}/${f}`));
    }
  }
  return out;
}

function svelteKitRoutes(root: string): Route[] {
  const dir = join(root, "src", "routes");
  if (!isDir(dir)) return [];
  const out: Route[] = [];
  for (const f of walk(dir, { maxFiles: 2000 })) {
    const m = /(^|\/)\+page\.(svelte|md|svx)$/.exec(f);
    if (!m) continue;
    const segs = f.slice(0, f.length - m[0].length).split("/").filter((s) => s && !(s.startsWith("(") && s.endsWith(")")));
    out.push(toRoute(segs, `src/routes/${f}`));
  }
  return out;
}

function nuxtRoutes(root: string): Route[] {
  const dir = ["pages", "app/pages", "src/pages"].find((d) => isDir(join(root, d)));
  if (!dir) return exists(join(root, "app.vue")) || exists(join(root, "app/app.vue")) ? [{ path: "/", dynamic: false, source: "app.vue (no pages/ directory)" }] : [];
  const out: Route[] = [];
  for (const f of walk(join(root, dir), { maxFiles: 2000 })) {
    if (!/\.vue$/.test(f)) continue;
    const segs = f.replace(/\.vue$/, "").split("/").filter((s) => s !== "index");
    out.push(toRoute(segs, `${dir}/${f}`));
  }
  return out;
}

function astroRoutes(root: string): Route[] {
  const dir = join(root, "src", "pages");
  if (!isDir(dir)) return [];
  const out: Route[] = [];
  for (const f of walk(dir, { maxFiles: 2000 })) {
    if (!/\.(astro|md|mdx|html)$/.test(f) || f.split("/").some((s) => s.startsWith("_"))) continue;
    const segs = f.replace(/\.(astro|md|mdx|html)$/, "").split("/").filter((s) => s !== "index");
    out.push(toRoute(segs, `src/pages/${f}`));
  }
  return out;
}

/** TanStack file names: "posts.$postId.tsx" nests with dots; "_layout" segments are pathless; "route.tsx" and "index" are the parent. */
function tanstackSegments(file: string): string[] | undefined {
  const flat = file.replace(/\.(tsx|ts|jsx|js)$/, "").split("/").flatMap((s) => s.split("."));
  const segs: string[] = [];
  for (const s of flat) {
    if (s === "__root") return undefined;
    if (s === "index" || s === "route") continue;
    if (s.startsWith("_")) continue;
    if (s.startsWith("(") && s.endsWith(")")) continue;
    segs.push(s);
  }
  return segs;
}

function tanstackRoutes(root: string): Route[] {
  const gen = ["src/routeTree.gen.ts", "app/routeTree.gen.ts", "routeTree.gen.ts"].find((f) => exists(join(root, f)));
  if (gen) {
    const text = readText(join(root, gen)) ?? "";
    const block = /interface FileRoutesByFullPath\s*\{([\s\S]*?)\}/.exec(text)?.[1] ?? "";
    const paths = [...block.matchAll(/'([^']+)'\s*:/g)].map((m) => m[1]);
    if (paths.length) return paths.map((p) => ({ path: p.replace(/\/$/, "") || "/", dynamic: /\$/.test(p), source: gen }));
  }
  const dir = ["src/routes", "app/routes", "routes"].find((d) => isDir(join(root, d)));
  if (!dir) return [];
  const out: Route[] = [];
  for (const f of walk(join(root, dir), { maxFiles: 2000 })) {
    if (!/\.(tsx|ts|jsx|js)$/.test(f)) continue;
    const segs = tanstackSegments(f);
    if (segs) out.push(toRoute(segs, `${dir}/${f}`));
  }
  return out;
}

function reactRouterRoutes(root: string): Route[] {
  const out: Route[] = [];
  const config = ["app/routes.ts", "app/routes.js"].find((f) => exists(join(root, f)));
  const text = config ? readText(join(root, config)) ?? "" : "";
  if (config && !/flatRoutes\(/.test(text)) {
    if (/\bindex\(/.test(text)) out.push({ path: "/", dynamic: false, source: config });
    for (const m of text.matchAll(/\broute\(\s*["'`]([^"'`]+)["'`]/g)) {
      const p = m[1].startsWith("/") ? m[1] : `/${m[1]}`;
      out.push({ path: p, dynamic: /:[A-Za-z]/.test(p) || /\*/.test(p), source: config });
    }
    if (out.length) return out;
  }
  const dir = join(root, "app", "routes");
  if (!isDir(dir)) return out;
  for (const f of walk(dir, { maxFiles: 2000, maxDepth: 1 })) {
    if (!/\.(tsx|ts|jsx|js|mdx|md)$/.test(f)) continue;
    const name = f.replace(/\/route\.(tsx|ts|jsx|js)$/, "").replace(/\.(tsx|ts|jsx|js|mdx|md)$/, "");
    const segs = name.split(".").filter((s) => s !== "_index" && !s.startsWith("_"));
    // ($lang) is an optional segment: it is a route with or without it; keep the shorter one.
    const kept = segs.filter((s) => !(s.startsWith("(") && s.endsWith(")")));
    out.push(toRoute(kept, `app/routes/${f}`));
  }
  return out;
}

/** The list for a framework id, static first, deduplicated, capped. Unknown frameworks yield nothing. */
export function discoverRoutes(root: string, frameworkId: string | undefined): Route[] {
  let found: Route[] = [];
  switch (frameworkId) {
    case "vinext":
    case "next": found = nextRoutes(root); break;
    case "sveltekit": found = svelteKitRoutes(root); break;
    case "nuxt": found = nuxtRoutes(root); break;
    case "astro": found = astroRoutes(root); break;
    case "tanstack-start": found = tanstackRoutes(root); break;
    case "react-router":
    case "remix": found = reactRouterRoutes(root); break;
    case "vite":
    case "cra":
    case "angular":
      // A SPA: one HTML document; anything else is the live walker's job.
      found = [{ path: "/", dynamic: false, source: `${frameworkId}: single-page application` }];
      break;
    default: found = [];
  }
  const seen = new Set<string>();
  const unique = found.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
  unique.sort((a, b) => {
    if (a.dynamic !== b.dynamic) return a.dynamic ? 1 : -1;
    const da = a.path.split("/").length, db = b.path.split("/").length;
    return da !== db ? da - db : a.path.localeCompare(b.path);
  });
  return unique.slice(0, ROUTE_CAP);
}
