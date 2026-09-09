import assert from "node:assert/strict";
import { test } from "node:test";
import { isProductDestination } from "@panoma/video-core";
import { urlOf } from "../packages/scout/src/profile.ts";

test("README provider setup links and local previews cannot become a product CTA", () => {
  const readme = `# MenuCard
Get a key at [Google AI Studio](https://makersuite.google.com/app/apikey).
Configure [Resend](https://resend.com) and [Firebase](https://console.firebase.google.com).
Read [Next.js](https://nextjs.org/docs) or run http://localhost:3000.
Clone https://github.com/tu-usuario/menucard.git.
`;
  assert.deepEqual(urlOf(undefined, readme), {});
  const page = "https://menucard.product.example/app?lang=es";
  assert.deepEqual(urlOf(undefined, `${readme}\nTry the product: ${page}`), { url: page, source: "README.md:7" });
  assert.deepEqual(urlOf({ homepage: page }, readme), { url: page, source: "package.json#homepage" });
});

test("destination filtering checks parsed hosts without rewriting accepted source URLs", () => {
  for (const value of ["http://127.0.0.1:5000", "https://10.2.3.4", "https://app.local", "https://user:pass@product.example", "mailto:help@product.example", "https://platform.openai.com/api-keys", "https://console.anthropic.com"]) assert.equal(isProductDestination(value), false, value);
  for (const value of ["https://panoma.ai", "https://example-product.vercel.app", "https://example-product.pages.dev", "https://github.com.product.example/docs?ref=launch"]) assert.equal(isProductDestination(value), true, value);
});

test("a starter's database guide is not a public product destination", () => {
  const readme = "# Training game\n\n## Learn More\n- [vinext Documentation](https://github.com/cloudflare/vinext)\n- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)\n";
  assert.deepEqual(urlOf(undefined, readme), {});
  assert.equal(isProductDestination("https://orm.drizzle.team/docs/get-started/d1-new"), false);
});
