/*
  The functions that run INSIDE the page. Playwright ships a function to Chromium by
  its source text, so nothing here may close over module scope: no imports used at
  runtime, no helpers from sibling files, no `this`. The pure logo heuristics the DOM
  walk needs travel the same way — `heuristicsSource()` serialises them and the page
  rehydrates them with `new Function` — which is dembrandt's device for keeping one
  copy of a rule that both a unit test and a browser must run (lib/extractors/
  logo.ts, Copyright (c) 2025 thevangelist, MIT License).

  Two collectors: `collectHead` reads the metadata the specs put in <head> (theme-color
  with its media variants, color-scheme, manifest, mask-icon, apple-touch-icon,
  rel=icon, og:*, the Google Fonts links, @font-face families, the resolved :root
  custom properties) and tags the longest paragraph for the font probe;
  `collectLogoCandidates` walks the zones dembrandt walks — header, nav, footer, hero,
  plus a global pre-scan for logo-named or home-linked marks — and returns facts, not
  scores. Scoring happens in Node (logo-score.ts) where a test can reach it.
*/
import { isHomeHref, isLogoSized, thirdPartyBrandFromAlt, type LogoCandidate } from "./logo-score.ts";

export type HeadFacts = {
  /** document.title before its first separator, when short enough to be a name. */
  titleName: string;
  ogSiteName: string;
  appName: string;
  manifestHref: string | null;
  colorScheme: string | null;
  themeColors: { content: string; media?: string }[];
  maskIcon: { href: string; color?: string } | null;
  appleTouchIcons: { href: string; sizes?: string }[];
  icons: { href: string; sizes?: string }[];
  ogImage: string | null;
  googleFontLinks: string[];
  fontFaces: { family: string; src: string }[];
  rootVars: Record<string, string>;
  bodyFamily: string;
};

/** Serialised twins of the pure heuristics, for `new Function` inside the page. */
export function heuristicsSource(): string {
  return [isHomeHref, thirdPartyBrandFromAlt, isLogoSized].map((fn) => fn.toString()).join("\n\n");
}

export function collectHead(): HeadFacts {
  const attr = (el: Element | null, name: string): string => (el?.getAttribute(name) ?? "").trim();
  const metas = Array.from(document.querySelectorAll("meta"));
  const links = Array.from(document.querySelectorAll("link"));
  const metaByName = (name: string): string => attr(metas.find((m) => (m.getAttribute("name") ?? "").toLowerCase() === name) ?? null, "content");
  const metaByProp = (prop: string): string => attr(metas.find((m) => (m.getAttribute("property") ?? "").toLowerCase() === prop) ?? null, "content");
  const rels = (rel: string): HTMLLinkElement[] => links.filter((l) => (l.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes(rel));

  const themeColors = metas
    .filter((m) => (m.getAttribute("name") ?? "").toLowerCase() === "theme-color" && attr(m, "content"))
    .map((m) => {
      const media = attr(m, "media");
      return media ? { content: attr(m, "content"), media } : { content: attr(m, "content") };
    });
  const maskLink = rels("mask-icon")[0] ?? null;
  const maskIcon = maskLink ? { href: attr(maskLink, "href"), ...(attr(maskLink, "color") ? { color: attr(maskLink, "color") } : {}) } : null;
  const withSizes = (l: HTMLLinkElement): { href: string; sizes?: string } => (attr(l, "sizes") ? { href: attr(l, "href"), sizes: attr(l, "sizes") } : { href: attr(l, "href") });
  const appleTouchIcons = [...rels("apple-touch-icon"), ...rels("apple-touch-icon-precomposed")].filter((l) => attr(l, "href")).map(withSizes);
  const icons = links
    .filter((l) => {
      const rel = (l.getAttribute("rel") ?? "").toLowerCase();
      return (rel === "icon" || rel === "shortcut icon" || rel.split(/\s+/).includes("icon")) && !rel.includes("apple") && !rel.includes("mask");
    })
    .filter((l) => attr(l, "href"))
    .map(withSizes);

  const googleFontLinks = links.map((l) => l.href).filter((href) => /fonts\.googleapis\.com/.test(href));
  const fontFaces: { family: string; src: string }[] = [];
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          const family = rule.style.getPropertyValue("font-family").replace(/['"]/g, "").trim();
          if (family) fontFaces.push({ family, src: rule.style.getPropertyValue("src") });
        }
      }
    }
  } catch {
    /* a cross-origin sheet: its faces are not ours to read */
  }

  /* Resolved :root custom properties, with dembrandt's framework-noise filters. */
  const rootVars: Record<string, string> = {};
  const styles = getComputedStyle(document.documentElement);
  const frameworkPalette = /^--(?:tw-)?colors?-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d00|950)$/;
  const nonBrand = /(competitor|error|danger|destructive|invalid|warning|success|info|alert|notice|disabled|placeholder|skeleton|shimmer|scrim|overlay|backdrop|tooltip)/;
  for (let i = 0; i < styles.length; i++) {
    const prop = styles[i];
    if (!prop.startsWith("--")) continue;
    if (/^--(wp--preset|el-|p-|chakra-|mantine-|ant-|bs-|swiper-|rsbs-|toastify-|tw-)/.test(prop)) continue;
    if (prop.includes("--system-") || prop.includes("--default-")) continue;
    if (nonBrand.test(prop) || frameworkPalette.test(prop)) continue;
    const value = styles.getPropertyValue(prop).trim();
    if (!value) continue;
    if (/^(#|rgb|hsl|oklab|oklch|color\(|[\d.]+\s+[\d.]+%\s+[\d.]+%$)/i.test(value) || /^--font/.test(prop)) rootVars[prop] = value;
  }

  /* Tag the longest paragraph so the font probe can find it by selector. */
  let longest: HTMLParagraphElement | null = null;
  let max = 0;
  for (const p of Array.from(document.querySelectorAll("p"))) {
    const len = (p.textContent ?? "").trim().length;
    if (len > max) {
      max = len;
      longest = p;
    }
  }
  if (longest) longest.setAttribute("data-panoma-video-longest", "1");

  const title = document.title.trim();
  const sep = title.match(/^(.+?)\s*[|\-–—:]\s+/);
  const titleName = sep && sep[1].length > 1 && sep[1].length < 40 ? sep[1].trim() : title.length < 40 ? title : "";

  return {
    titleName,
    ogSiteName: metaByProp("og:site_name"),
    appName: metaByName("application-name"),
    manifestHref: attr(rels("manifest")[0] ?? null, "href") || null,
    colorScheme: metaByName("color-scheme") || null,
    themeColors,
    maskIcon,
    appleTouchIcons,
    icons,
    ogImage: metaByProp("og:image") || null,
    googleFontLinks,
    fontFaces,
    rootVars,
    bodyFamily: document.body ? getComputedStyle(document.body).fontFamily.split(",")[0].replace(/['"]/g, "").trim() : "",
  };
}

export function collectLogoCandidates({ siteDomain, heuristics }: { siteDomain: string; heuristics: string }): LogoCandidate[] {
  const H = new Function(heuristics + "\nreturn { isHomeHref, thirdPartyBrandFromAlt, isLogoSized };")() as {
    isHomeHref: (href: unknown, origin: unknown) => boolean;
    thirdPartyBrandFromAlt: (alt: unknown, site: unknown) => string | null;
    isLogoSized: (w: unknown, h: unknown) => boolean;
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");

  const toHex = (color: string | null): string | null => {
    if (!color || color === "transparent") return null;
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    const two = (n: number): string => n.toString(16).padStart(2, "0");
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) < 0.1) return null;
      return `#${two(+m[1])}${two(+m[2])}${two(+m[3])}`;
    }
    if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
    if (!ctx) return null;
    try {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return a < 25 ? null : `#${two(r)}${two(g)}${two(b)}`;
    } catch {
      return null;
    }
  };
  const findBg = (el: Element): string | null => {
    let node: Element | null = el;
    while (node && node.tagName !== "HTML") {
      const bg = toHex(getComputedStyle(node).backgroundColor);
      if (bg) return bg;
      node = node.parentElement;
    }
    return null;
  };
  const classOf = (el: Element): string => {
    const c = (el as HTMLElement).className as unknown;
    return typeof c === "string" ? c : ((c as SVGAnimatedString | undefined)?.baseVal ?? "");
  };
  const visible = (el: Element | null): el is Element => {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  /* A customer / partner wall: three or more sizable marks in one local container, outside the chrome. */
  const inLogoWall = (el: Element): boolean => {
    const r0 = el.getBoundingClientRect();
    if (r0.width < 24 || r0.height < 8) return false;
    if (el.closest('header, nav, [role="banner"], footer, [role="contentinfo"], [class*="footer" i], [id*="footer" i]')) return false;
    if (r0.top + window.scrollY < 180) return false;
    let node = el.parentElement;
    for (let d = 0; d < 3 && node && !/^(BODY|MAIN|HTML)$/.test(node.tagName); d++, node = node.parentElement) {
      let count = 0;
      for (const m of Array.from(node.querySelectorAll("img, svg"))) {
        const r = m.getBoundingClientRect();
        if (r.width >= 24 && r.height >= 8 && ++count >= 3) return true;
      }
    }
    return false;
  };

  const describe = (el: Element, context: LogoCandidate["context"]): LogoCandidate | null => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const n = (v: string): number => parseFloat(v) || 0;
    const rect = {
      top: Math.round(r.top + window.scrollY),
      left: Math.round(r.left + window.scrollX),
      width: Math.round(Math.max(0, r.width - n(cs.borderLeftWidth) - n(cs.borderRightWidth) - n(cs.paddingLeft) - n(cs.paddingRight))),
      height: Math.round(Math.max(0, r.height - n(cs.borderTopWidth) - n(cs.borderBottomWidth) - n(cs.paddingTop) - n(cs.paddingBottom))),
    };
    const link = el.closest("a");
    const base: Omit<LogoCandidate, "source" | "natural"> = {
      context,
      alt: el.getAttribute("alt") ?? "",
      className: classOf(el),
      id: el.id ?? "",
      ariaLabel: el.getAttribute("aria-label") ?? (link && /home/i.test(link.getAttribute("aria-label") ?? "") ? (link.getAttribute("aria-label") as string) : ""),
      linkHref: link?.getAttribute("href") ?? "",
      rect,
      background: findBg(el),
      colors: [],
    };
    if (el.tagName === "IMG") {
      const img = el as HTMLImageElement;
      let src = img.currentSrc || img.src;
      if (!src || src === location.href) {
        const entries = (img.getAttribute("srcset") ?? "").split(",").map((s) => s.trim().split(/\s+/)).map(([u, w]) => ({ u, w: parseFloat(w) || 0 })).filter((e) => e.u);
        entries.sort((a, b) => b.w - a.w);
        if (entries[0]) src = new URL(entries[0].u, location.href).href;
      }
      if (!src) return null;
      let srcHost = "";
      try {
        srcHost = new URL(src).hostname;
      } catch {
        /* a data: URI has no host */
      }
      return { ...base, source: "img", url: src, natural: { width: img.naturalWidth, height: img.naturalHeight }, ...(srcHost ? { srcHost } : {}) };
    }
    if (el.tagName.toLowerCase() === "svg") {
      const svg = el as SVGSVGElement;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const color = toHex(cs.color);
      if (color) clone.style.color = color;
      if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const markup = clone.outerHTML;
      if (!markup || markup.length > 50_000) return null;
      const colors: string[] = [];
      for (const child of Array.from(svg.querySelectorAll("*"))) {
        for (const a of ["fill", "stroke"]) {
          const v = child.getAttribute(a);
          if (v && v !== "none" && v !== "currentColor" && v !== "inherit") {
            const hex = toHex(v);
            if (hex && !colors.includes(hex)) colors.push(hex);
          }
        }
      }
      if (color && /currentColor/.test(markup) && !colors.includes(color)) colors.push(color);
      const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
      const natural = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? { width: vb[2], height: vb[3] } : { width: 0, height: 0 };
      return { ...base, source: "svg", markup, natural, colors };
    }
    return null;
  };

  /* dembrandt's qualification: named like a logo, or drawn from a logo sprite, or home-linked. */
  const qualifies = (el: Element): boolean => {
    const attrs = `${classOf(el)} ${el.id ?? ""} ${el.getAttribute("alt") ?? ""}`.toLowerCase();
    if (attrs.includes("logo") || attrs.includes("brand")) return true;
    if (el.tagName.toLowerCase() === "svg") {
      for (const use of Array.from(el.querySelectorAll("use"))) {
        const href = (use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "").toLowerCase();
        if (href.includes("logo") || href.includes("brand")) return true;
      }
      const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
      if (label.includes("home") || label.includes("logo")) return true;
    }
    const link = el.closest("a");
    if (link) {
      const href = (link.getAttribute("href") ?? "").toLowerCase();
      const label = (link.getAttribute("aria-label") ?? "").toLowerCase();
      if (href === "/" || /^https?:\/\/[^/]+\/?$/.test(href) || label.includes("home")) return true;
    }
    return false;
  };

  const found: { el: Element; context: LogoCandidate["context"] }[] = [];
  const seen = new Set<Element>();
  const add = (el: Element, context: LogoCandidate["context"]): void => {
    if (seen.has(el) || !visible(el)) return;
    const homeLinked = H.isHomeHref(el.closest("a")?.getAttribute("href"), location.origin);
    if (!homeLinked && (H.thirdPartyBrandFromAlt(el.getAttribute("alt") ?? "", siteDomain) || inLogoWall(el))) return;
    seen.add(el);
    found.push({ el, context });
  };
  const scanZone = (container: Element | null, context: LogoCandidate["context"]): void => {
    if (!container) return;
    for (const el of Array.from(container.querySelectorAll("img, svg"))) if (qualifies(el)) add(el, context);
  };
  const firstChildren = (container: Element | null, context: LogoCandidate["context"]): void => {
    if (!container) return;
    for (const child of Array.from(container.children).slice(0, 3)) {
      if (child.matches("img, svg") && qualifies(child)) add(child, context);
      scanZone(child, context);
    }
  };

  /* Global pre-scan: logo-named containers and home links anywhere, above the fold or home-linked. */
  const marks = new Set<Element>();
  document.querySelectorAll('[class*="logo" i] img, [class*="logo" i] svg, [id*="logo" i] img, [id*="logo" i] svg').forEach((el) => marks.add(el));
  document.querySelectorAll("a[href]").forEach((a) => {
    if (!H.isHomeHref(a.getAttribute("href"), location.origin)) return;
    a.querySelectorAll("img, svg").forEach((el) => marks.add(el));
  });
  for (const el of marks) {
    const r = el.getBoundingClientRect();
    if (r.width > 1500 || r.height > 500 || !H.isLogoSized(r.width, r.height)) continue;
    const homeLinked = H.isHomeHref(el.closest("a")?.getAttribute("href"), location.origin);
    const top = r.top + window.scrollY;
    if (top > 500 && !homeLinked) continue;
    add(el, top <= 500 ? "header" : top > document.documentElement.scrollHeight - 1200 ? "footer" : "body");
  }

  const pick = (selectors: string[], accept: (el: Element) => boolean = () => true): Element | null => {
    for (const sel of selectors) for (const el of Array.from(document.querySelectorAll(sel))) if (visible(el) && accept(el)) return el;
    return null;
  };
  const headerEl =
    pick(["header", '[role="banner"]', '[class*="header"]', '[id*="header"]'], (el) => {
      const r = el.getBoundingClientRect();
      return r.top < 300 && r.width > window.innerWidth * 0.3;
    }) ?? pick(["header", '[role="banner"]']);
  const navEl = pick(["nav", '[role="navigation"]']);
  const footerEl = pick(["footer", '[role="contentinfo"]', '[class*="footer"]', '[id*="footer"]']);
  const heroEl = pick(['main > *:first-child', '[class*="hero"]', '[class*="Hero"]', '[class*="banner"]:not([role="banner"])'], (el) => el.getBoundingClientRect().height > 200);

  firstChildren(headerEl, "header");
  if (navEl && !headerEl?.contains(navEl)) firstChildren(navEl, "header");
  scanZone(footerEl, "footer");
  scanZone(heroEl, "hero");

  return found.map(({ el, context }) => describe(el, context)).filter((c): c is LogoCandidate => c !== null);
}
