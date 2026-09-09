/*
  The rule that keeps an automatic trailer from being a slideshow: a claim needs a
  proof, a proof is a state change, and a heading is neither.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { bindClaims, claimCard, isProof, momentScore, resolveGoals, unclaimedProofs, type ClaimSource, type Moment } from "@panoma/video-core";

const moments: Moment[] = [
  { id: "hero", kind: "hero", name: "Your disk, catalogued", stateDelta: 0, candidateScore: 0, inAllTakes: true },
  { id: "memory", kind: "section", name: "The most advanced memory", stateDelta: 0, candidateScore: 0, inAllTakes: true },
  { id: "cta", kind: "cta", name: "Get started", route: "/", stateDelta: 0.42, candidateScore: 0.9, inAllTakes: true },
  { id: "projects", kind: "flow", name: "Open project memory", route: "/projects", stateDelta: 0.6, candidateScore: 0.5, inAllTakes: false },
];

const claims: ClaimSource[] = [
  { text: "feat: add project memory that updates itself", source: "git:abc", tier: 5 },
  { text: "Installation", source: "README.md:20", tier: 4 },
  { text: "The most advanced memory for your agents", source: "site:h2", tier: 6 },
  { text: "Get started in one command", source: "CHANGELOG.md:4", tier: 2 },
];

test("claim cards strip prefixes and refuse anything over five words", () => {
  assert.equal(claimCard("feat(core): add support for project memory"), "Project memory");
  assert.equal(claimCard("- Added dark mode."), "Dark mode");
  assert.equal(claimCard("a claim that is far too long to be a card"), null);
});

test("a scroll to a heading proves nothing; a click that changes the interface does", () => {
  assert.equal(isProof(moments[1]), false);
  assert.equal(isProof(moments[1], { staticSite: true }), true);
  assert.equal(isProof(moments[2]), true);
  assert.equal(isProof({ ...moments[2], stateDelta: 0 }), false);
  assert.ok(momentScore(moments[3]).score > momentScore(moments[1]).score);
});

test("claims bind by shared words to state-changing moments, each used once, best first", () => {
  const pairs = bindClaims(claims, moments, { gitHeat: { "/projects": 7 } });
  assert.deepEqual(pairs.map((p) => p.moment.id), ["projects", "cta"]);
  assert.equal(pairs[0].claim.text, "Project memory that updates itself");
  assert.equal(pairs[1].claim.text, "Get started in one command");
  /* "Installation" and the site's own marketing heading bind to nothing and vanish. */
  assert.ok(pairs.every((p) => !/installation|advanced memory/i.test(p.claim.text)));
  assert.ok(pairs[0].reasons.some((r) => r.startsWith("route touched")));
});

test("a proof nobody claimed keeps its own name as the label", () => {
  const pairs = bindClaims(claims.slice(1, 2), moments);
  const rest = unclaimedProofs(moments, pairs);
  assert.deepEqual(rest.map((p) => p.claim.text), ["Get started", "Open project memory"]);
  assert.ok(rest.every((p) => p.claim.tier === 1 && p.moment.stateDelta > 0));
});

test("goals follow the kind and the evidence, and every skip says what would unlock it", () => {
  const web = resolveGoals({ kind: "web-app", boundPairs: 3, flows: 2, hasInstallCommand: true, hasReachableTag: true, changelogHeroItems: 0, featCommits: 1, sectionMarks: 4 });
  assert.deepEqual(web.make.map((g) => g.goal), ["trailer", "spotlight", "tutorial"]);
  assert.ok(web.skip.some((g) => g.goal === "changelog" && /feat/.test(g.why)));

  const site = resolveGoals({ kind: "static-site", boundPairs: 3, flows: 0, hasInstallCommand: false, hasReachableTag: false, changelogHeroItems: 0, featCommits: 0, sectionMarks: 5 });
  assert.deepEqual(site.make.map((g) => g.goal), ["sitetour"], "sections never make a trailer");

  const cli = resolveGoals({ kind: "cli", boundPairs: 0, flows: 0, hasInstallCommand: true, hasReachableTag: true, changelogHeroItems: 2, featCommits: 0, sectionMarks: 0 });
  assert.deepEqual(cli.make.map((g) => g.goal), ["changelog", "facts", "tutorial"]);
});

test("a tutorial is earned by a task, not by a README", () => {
  /*
    The gate used to be an install command in a code fence, which is paperwork: most
    applications never document one, and the ones that do are not the ones with
    something to teach. What a tutorial needs is a control the viewer can be shown
    using — and the walk already refuses to mark a click that changed nothing.
  */
  const app = resolveGoals({ kind: "web-app", boundPairs: 0, flows: 1, hasInstallCommand: false, hasReachableTag: true, changelogHeroItems: 0, featCommits: 0, sectionMarks: 3 });
  assert.ok(app.make.some((g) => g.goal === "tutorial"), "one control that changes the interface is a task to teach");
  assert.match(app.make.find((g) => g.goal === "tutorial")!.why, /changes the interface: 1$/, "the count closes the sentence");

  /* A page with nothing to press teaches nothing, and the skip says exactly that. */
  const brochure = resolveGoals({ kind: "web-app", boundPairs: 0, flows: 0, hasInstallCommand: false, hasReachableTag: true, changelogHeroItems: 0, featCommits: 0, sectionMarks: 6 });
  assert.ok(!brochure.make.some((g) => g.goal === "tutorial"));
  assert.match(brochure.skip.find((g) => g.goal === "tutorial")!.why, /no control whose use changes the interface/);
  /* What it does earn is the piece that is honest about being a page: a site tour. */
  assert.ok(brochure.make.some((g) => g.goal === "sitetour"));

  /* And the old door is still open: how to get the thing at all is the one instruction no footage shows. */
  const documented = resolveGoals({ kind: "web-app", boundPairs: 0, flows: 0, hasInstallCommand: true, hasReachableTag: true, changelogHeroItems: 0, featCommits: 0, sectionMarks: 2 });
  assert.match(documented.make.find((g) => g.goal === "tutorial")!.why, /install command/);
});
