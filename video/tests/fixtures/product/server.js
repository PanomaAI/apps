// A small product with real structure: landmarks, sections, a call to action that
// navigates, and a button that changes the page — what a tour needs to find proof.
import { createServer } from "node:http";
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="theme-color" content="#d2bd7f"><style>body{font:18px/1.5 system-ui;margin:0;background:#0a0a0a;color:#fafafa}
header{display:flex;gap:24px;padding:16px 32px;border-bottom:1px solid #242424}main{padding:32px}section{min-height:60vh}
a.cta,button{display:inline-block;background:#d2bd7f;color:#0a0a0a;padding:12px 20px;border-radius:8px;font-weight:700;text-decoration:none;border:0;font-size:18px}
h1{font-size:48px;margin:0 0 8px}h2{font-size:32px;margin-top:64px}</style></head><body>
<header><a href="/">acme</a><nav aria-label="Main"><a href="/">Home</a> <a href="/start">Start</a></nav></header>
<main>${body}</main><footer><p>acme-catalog</p></footer></body></html>`;
createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (req.url === "/start") {
    res.end(page("Start · acme", `<h1>Your catalog</h1><p>Projects found on this disk.</p>
<button id="open" onclick="document.getElementById('list').hidden=false;this.textContent='Catalog open'">Open catalog</button>
<section id="list" hidden><h2>Project memory</h2><ul><li>panoma</li><li>vira</li><li>apuntes</li></ul></section>`));
    return;
  }
  res.end(page("acme", `<section><h1>acme catalog</h1><p>The local catalog of your side projects.</p><a class="cta" href="/start">Get started</a></section>
<section><h2>Every project on one page</h2><p>Nothing leaves the machine.</p></section>
<section><h2>Project memory</h2><p>It updates itself and your agents read it.</p></section>`));
}).listen(port, host, () => console.log(`acme listening on http://${host}:${port}`));
