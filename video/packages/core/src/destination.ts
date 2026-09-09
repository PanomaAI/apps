/* Source selection, not a network availability check. Provider setup, framework
   documentation and local preview addresses cannot stand in for a product site. */
const EXCLUDED_HOSTS = [
  "github.com", "gitlab.com", "bitbucket.org", "githubusercontent.com", "npmjs.com", "npm.im",
  "shields.io", "badgen.net", "codecov.io", "coveralls.io", "circleci.com", "travis-ci.org",
  "opensource.org", "choosealicense.com", "pypi.org", "crates.io", "rubygems.org", "packagist.org",
  "discord.com", "discord.gg", "twitter.com", "x.com", "reddit.com", "youtube.com", "youtu.be", "gitter.im", "producthunt.com",
  "makersuite.google.com", "aistudio.google.com", "console.firebase.google.com", "firebase.google.com", "console.cloud.google.com", "cloud.google.com",
  "platform.openai.com", "platform.claude.com", "console.anthropic.com", "resend.com", "dashboard.stripe.com",
  "nextjs.org", "react.dev", "reactjs.org", "tailwindcss.com", "typescriptlang.org", "nodejs.org", "vite.dev", "vitejs.dev", "vercel.com", "drizzle.team",
];

export function isProductDestination(value: string): boolean {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host) || /(?:^|\.)(?:localhost|local|internal)$/.test(host)) return false;
    if (EXCLUDED_HOSTS.some((excluded) => host === excluded || host.endsWith(`.${excluded}`))) return false;
    return !/\.(?:svg|png|jpe?g|gif|webp)$/i.test(url.pathname);
  } catch { return false; }
}
