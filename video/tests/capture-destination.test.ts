import assert from "node:assert/strict";
import { test } from "node:test";
import { atReadingDestination, readingDestination } from "../packages/capture/src/settle.ts";

test("an observed destination wins over an intermediate link and only asserts the URL parts observed", () => {
  const destination = readingDestination("http://product.test/catalog", "/projects/final", "http://product.test/redirect");
  assert.ok(destination);
  assert.equal(atReadingDestination("http://product.test/redirect", destination), false);
  assert.equal(atReadingDestination("http://product.test/projects/final/?campaign=launch#details", destination), true);
  assert.equal(atReadingDestination("http://other.test/projects/final", destination), false);
  assert.equal(atReadingDestination("http://product.test/projects/final/other", destination), false);
});

test("a current path observation cannot hide a real query or fragment destination on the pressed link", () => {
  const destination = readingDestination("http://product.test/catalog?tab=recent", "/catalog", "http://product.test/catalog?tab=all#saved");
  assert.ok(destination);
  assert.equal(atReadingDestination("http://product.test/catalog?tab=recent", destination), false);
  assert.equal(atReadingDestination("http://product.test/catalog?tab=all", destination), false);
  assert.equal(atReadingDestination("http://product.test/catalog?tab=all#saved", destination), true);
  const explicit = readingDestination("http://product.test/catalog", "/catalog?tab=all#saved");
  assert.deepEqual(explicit, destination);
});

test("unchanged URLs, external links and non-web destinations add no navigation wait to toggles", () => {
  const url = "http://product.test/catalog";
  assert.equal(readingDestination(url), undefined);
  assert.equal(readingDestination(url, "/catalog/", url), undefined);
  assert.equal(readingDestination(url, "https://other.test/detail", "mailto:team@example.com"), undefined);
  assert.equal(readingDestination(url, undefined, "javascript:void(0)"), undefined);
  assert.equal(readingDestination("not a URL", "/detail"), undefined);
  const fragment = readingDestination("http://product.test/catalog?sort=name", "/detail#question?answer");
  assert.ok(fragment);
  assert.equal(atReadingDestination("http://product.test/detail?sort=other#question?answer", fragment), true,
    "a question mark inside a fragment does not assert an empty query");
});
