# Tour

> A running product goes in; the recording script comes out; nobody wrote it.

`@panoma/video-tour` walks a product in a browser and writes the session `panoma-video record`
shoots — the hero, one scroll per section, the call to action, the pages behind it —
with a mark on every moment a sentence can later be pinned to. No model is consulted.
Everything it decides is written into the script with its reason, so a person or an
agent can edit the result without driving a browser again.

## What every vendor does, and what this does instead

Arcade, Navattic, Supademo, Guidde and Clueso all derive a demo from clicks a human
made: capture per click, hotspot on the clicked element, pan-and-zoom onto it, one
sentence per step. The recipe is right; the human is the cost. panoma video has no human, so it
makes the clicks itself from the one thing every product already publishes for free:
its accessibility tree.

Playwright's `ariaSnapshot({ mode: "ai", boxes: true })` (mode since 1.59, boxes since
1.60) returns, in one call, every visible element's role, accessible name, a `[ref=eN]`,
`[cursor=pointer]`, `[active]` and `[box=x,y,w,h]`. WAI-ARIA landmarks — `banner`,
`navigation`, `main`, `contentinfo` — already say which part of a page is chrome and
which is content. That is the whole page-understanding layer; the rest is arithmetic.

## The walk

1. **Open** the URL in the desktop take (dark scheme, like the recorder).
2. **Consent** — a button whose name is on the consent list is clicked, most
   privacy-preserving first (`Reject all`, `Reject`, `Decline`… `Accept` last). Only if
   the page's state actually changed does the click become a step, and then as
   `role: "chrome"` and `optional: true`: it earns no shot and is not there on a second
   visit.
3. **Hero** — `{ mark: "hero" }` on the page's first heading, then a hold.
4. **Sections** — every h1/h2 inside `main` after the page's own heading, in document
   order: `{ mark }`, `{ scrollTo: <heading selector>, at: 0.26, ms: 1100 }`, hold. The
   mark is the heading slugified (`discover-what-is-on-the-disk`) and made unique.
5. **The call to action** — the top-ranked candidate (below) is approached with a
   `scrollTo` (flagged `back: true` when the recorder's own guard would refuse the
   distance), clicked, and judged by what the page did: left the origin → undone and
   refused; state hash unchanged → a no-op, refused; a state already shown → refused.
   Only a new same-origin state becomes `{ mark: "cta" }` + `{ clickOn }`. If it was a
   new page, that page gets its own section pass and its own CTA, until the CTA budget
   is spent.
6. **The navigation** — breadth-first over the primary navigation's same-origin links,
   minus chrome and destructive names. A link is clicked from the page it was seen on
   (a `goto` brings the tour back there first when needed) and becomes a `flow` mark;
   the page behind it gets a section pass. Visited URLs and the state hash stop the
   tour from showing one page twice under two names.
7. **The mobile re-walk** — see below.

The pause after a product action is a reading budget, not a fixed beat count. The
walker counts newly visible result text after a press, or the visible section under
its heading, excluding unchanged copy, navigation and offscreen content. It writes
1.8–3.2 seconds for a tour and 2.6–4.8 seconds for a lesson, with the longer budget
reserved for a result that has something to read. Source footage does not need to
land on beats; the renderer makes the cut once its narration is known.

These pauses carry `settled: true`. During recording, visible text and control
positions must stop changing for 320 ms before the reading budget begins, with at
least 500 ms observation and at most 2.8 seconds of settling. A visible busy
indicator, a visible image still loading, or a finite animation keeps the check open; an endless decorative loop
does not. This observes client transitions that a network-idle check misses. It is
a bounded observation, so a result that arrives later without a loading indicator
can still need a longer authored script. Consent and other chrome keep their short
pause and earn no reading shot.

The walker **executes** what it plans before writing it. A recording that dies at step
nine is discovered when the render looks wrong; a candidate that cannot be clicked is
discovered here, and dropped with its reason.

## What a click did is measured against the instant before it

`landed()` records the heading a click produced, and that heading becomes a fact
(`ui.<mark>.result`) a film may quote: "click Get started and Your catalog opens". Both
halves of that sentence have to be observed, so the "before" it is diffed against must be
the page as it was **immediately** before this click — not as it was when the pass began.

It was the latter until 2026-09-03, and the failure it produced is the exact one the fact
layer exists to prevent. On a real product the walk approached a destination button,
Playwright reported it could not be clicked, the application had moved to that destination
anyway, and the next click — an unrelated mute toggle — was credited with the heading that
attempt had left behind. A fact was minted with a source
(`interface:…#cta (the heading the page showed after this step)`), the director bound a
claim to it, and the tutorial said out loud: *"Click Desactivar sonido del ritual; the
heading changes to Marte."* Grammatical, sourced, and true of nothing. The audit passed it
because the audit checks **provenance, not causation**.

So both passes now snapshot the page after the approach and immediately before the click,
and diff against that. The no-op test uses it too: a click that changes nothing is only
recognisable against a current picture. **The residual risk is a page that animates itself
between the two frames** — a 3D scene, a ticking clock, a carousel — where a heading can
change for reasons the click had nothing to do with. Nothing in the walker can tell those
apart today; a film built from such a product should be read with that in mind.

A heading must also be on the settled frame. The accessibility tree includes text
below the fold and inside clipped panels; its presence alone is not a visible
outcome. `landed()` checks viewport intersection, ancestor clipping and center
occlusion before naming a heading. On a changed route, the destination h1 can
repeat the catalog card that led there: seeing that name before the click does not
mean the detail page was already open. An unchanged local toggle still needs a new
visible heading, so it cannot borrow the page's old title.

The recorder verifies the exact heading again in each layout and writes
`MacroAsset.resultHeading` with its text, box and measured visibility. An empty
offscreen intersection is rejected before pixel rounding; it cannot turn into a
one-pixel focus. `focus` remains camera geometry and older focus rectangles do not
prove visibility. Tour version 12 and capture version 16 invalidate automatic
caches. `tests/outcome-visibility.test.ts` covers repeated destination names,
offscreen recommendations, clipped panels and visible dialog results in real
browsers and recordings.

## A model as re-ranker, never as executor

`writeTour` takes an optional `rerank` hook and a list of `verbs`. When panoma video has a brain
([brain.md](brain.md)), the scorer still ranks every button and link, and the brain is then
asked — with the ranked candidates, their reasons and the page's accessibility tree — for
an order of indexes, which the walker tries first. Only what the scorer set aside for
*where* it sits is on offer (a destination list in a `complementary` landmark can be the
product's main task); what it refused for what it *is* — destructive, external, chrome,
off-origin, the page itself — is never offered and is skipped at score 0 whatever the
answer says. The brain's choice is written into the candidate's reasons beside the
scorer's (`brain: ranked #1 — …`), and a brain that does not answer leaves the scorer's
order in place, on the record. The verbs it supplies in the interface's language join the
English lexicon for the verb bonus; the destructive list is not extended from there.
`tests/tour.test.ts` walks the fixture with a re-ranker that prefers the pricing link and
names a destructive one by a bogus index.

A candidate can disappear while the model decides. An approach timeout is
recoverable only when the exact selector is now absent and the page and browser
remain open. The walker drops staged steps for that attempt, records the refusal
and keeps later candidates. The mobile replay makes a missing action optional and
marks it unreached. A still-present target, a closed browser or another evaluation
error retains its failure. This handles the tested stale-snapshot case; it does
not establish the cause of every intermittent timeout seen on a real product.

## Candidates: how a call to action is chosen

Every button and link gets a candidate record in the shape of Stagehand's `observe()`
result — `{ selector, description, method, box, score, reasons[] }` — so a model can be
dropped in later as a re-ranker and never as the executor. The score is an ordering,
not a measurement, and the reasons make it auditable:

| Signal | Weight | Why |
| --- | --- | --- |
| role button / link | 1 / 0.8 | buttons act, links go somewhere; the tour prefers to show an action |
| inside `main` / `banner` | +1 / +0.5 | content beats chrome |
| inside the first viewport | +1 | Navattic: 80% of top CTAs are above the fold |
| inside the hero (above the first section heading) | +0.5 | the hero's own button wins a tie with a footer's |
| area, saturating at 7500 px² | up to +1 | WCAG 2.5.5 asks 44×44 (1936 px²); a hero button is ~150×50 |
| a verb from the lexicon | +2 | `get started`, `try`, `install`, `docs`, `learn more`… |

Three lists gate the score, checked in the order of what they cost when wrong:

- **Destructive** — `delete`, `remove`, `pay`, `purchase`, `checkout`, `send`,
  `publish`, `archive`, `reset`, `revoke`, `unsubscribe`, `subscribe`, `submit`,
  `log out`… Score 0, reason `never clicked`, on any page, under any budget, and a verb
  in the same name does not rescue it ("Add and pay" is destructive).
- **Chrome** — `accept`, `reject`, `cookie`, `close`, `dismiss`, `sign in`, `log in`,
  `menu`, `search`, `language`… Never a call to action.
- **Off-origin, `mailto:`, `tel:`, links to the page itself** — ranked, never clicked.

The tour never types into a field and never submits a form: `type` and `press` do not
exist in what it writes.

## Selectors

A step names its destination, never a pixel and never a ref. Refs (`e7`) are valid only
until the next action in the process that issued them; boxes change with every scroll.
What is persisted is the documented role selector with the `s` suffix for a
case-sensitive whole-name match:

```
role=link[name="Get started"s]
role=heading[name="Health at a glance"s][level=2]
role=button[name="Reject"s]
```

Without the suffix the name is a case-insensitive substring, and `Docs` also matches
`Docs and guides` — which is the class of bug that sent the panoma tour back to the top
of the page (`text=` matched an earlier sentence). Heading selectors carry the level so
two equal titles at different levels differ, and a heading that repeats on a page is
used once: the recorder scrolls to the *first* match.

## Scrolling inside the product

`scrollTo` is resolved by `@panoma/video-capture`'s `scrollToTarget`, shared by the desktop
walk, mobile re-walk, lesson proof and recorder. The nearest scrolling ancestor owns
the requested alignment; outer scrollports move only as far as needed to reveal it.
Horizontal overflow, right-to-left scrolling, borders and scaled containers are
measured from the live DOM. A locked window does not stand in for a moving panel.

The walker moves instantly and stores the resulting viewport box. The camera uses
one requestAnimationFrame easing clock for the whole ancestor chain and temporarily
disables CSS smooth scrolling and scroll snapping, restoring both properties and their
priorities afterwards. Scroll events carry actual displacement and elapsed time;
horizontal displacement is optional `x`. A no-op emits no fabricated motion event.

A control may have a box inside the viewport and still be clipped by its panel.
Visibility therefore intersects the target with its ancestors before a macro is
captured. An off-panel control arms its mark until the press. `clickOn` approaches a
clipped control when a script omitted that scroll, then logs the click at the newly
measured center. A covered or unreachable required target fails explicitly; an
optional target is skipped. Legacy pixel wheel steps follow the scrollable element
under the pointer.

The backward guard uses a quarter of the scrollport that would move, and refuses
before moving any ancestor. The walker writes `back: true` from that same measurement.
Rejected lesson attempts restore their previous ancestor scroll positions, so the
next planned step and the eventual recording start from the same state.

This operates on elements present in the DOM. A virtualized destination that has not
been rendered cannot be found by its selector; panoma video does not invent pixel distances
to search for it. `tests/capture-scroll.test.ts` exercises both take layouts, nested
and horizontal panels, the recorder's real video and press macro, and tour replay.

## The state hash

`stateHash(nodes, controls)` hashes the roles and names in document order, plus
observed selection and disclosure states on real interactive controls. Some products
show a selected option solely through an `active` or `selected` CSS class. Ignoring
that state threw away valid prerequisite clicks before their result action was enabled.
The supplementary observation accepts a finite vocabulary: selected, active, open,
checked and expanded class tokens (also `is-`/`is_` forms), finite `data-state`
values, explicit ARIA state, and native checked, disabled and disclosure state.

Refs, boxes, scroll position, focus, hover, animation classes, arbitrary data and
decorative elements stay outside identity. Observation does not modify ARIA or
accessible names, and a class change supplies no outcome heading or factual claim.
Only the real result heading or route can do that; promotional proof still requires
measured changed pixels in the recording. Disabled controls are offered only after
the page enables them, and controls already used on a page leave the re-rank menu.
`tests/tour-control-state.test.ts` exercises a four-action local workflow whose first
three selections change only CSS before enabling the final action.

## One step list for two takes

Every vendor crops a desktop capture into a phone-shaped hole. panoma video records the
product's own portrait layout, and that layout hides things: the navigation folds into
a button, secondary links disappear. A script written on the desktop take would die at
the first hidden target under the mobile camera — or, worse, a tutorial pinned to a mark
only one take carries would render in 16:9 and fail in 9:16.

So the script is re-run on the mobile take (720×1280, phone user agent, touch — the
same context the recorder opens) and repaired rather than forked:

- A target hidden behind a collapsed navigation gets the menu button — a button in the
  banner or navigation carrying `aria-expanded` — inserted before it as
  `{ scrollTo: menu, back: true, optional: true }`, `{ clickOn: menu, optional: true,
  role: "chrome" }`, a hold. Optional, because on the desktop take the button is not
  rendered and the recorder skips an optional step whose target is gone.
- A target that is simply not there becomes `optional: true`, so the step is skipped on
  that take and its mark still fires, on both takes, in the same order.

Nothing is removed and no mark moves. `TourScript.steps` is one list, and it is the
list both takes run.

## Marks and their targets

Each mark carries `kind` (`hero`, `section`, `cta`, `flow`), a `label` (the heading or
element text) and a `target` box: viewport coordinates of the desktop take *after* the
step's scroll has landed — a section heading sits at 26% of the viewport, a click target
at 40%. That is the hotspot Arcade's auto pan-and-zoom aims at (present in 80% of its
top demos); here it exists before a single frame is recorded, and the ScreenCast zoom
can take it.

A mark whose step *changed the page* also carries an `outcome`: the heading the page
showed once the click landed, and the route it landed on. This costs nothing — the walk
already takes that snapshot to decide whether the click did anything, and used to throw
it away — and it is what lets a narrated tutorial say the second half of a sentence.
"Click Get started" is what every tool can write; "click Get started and Your catalog
opens" needs an observation, and this is it, with the page as the source
([tutorials.md](tutorials.md)). A scroll to a heading changes nothing and therefore
claims nothing: only `cta` and `flow` marks have one.

Because a tour is cached on the *product* — its commit, its working tree, its steps — a
script written by an older walker would be served forever to a project that had not
changed, and a new field on a mark would reach nobody. So `TOUR_VERSION` is part of the
key. Bump it when the walk starts recording something a brief can read.

## The DevTools Recorder flow

`TourScript.flow` is the tour as Chrome DevTools Recorder JSON, the one recording
format that is free, standard and replayable (`@puppeteer/replay`, Apache-2.0; the
types are copied from its `src/Schema.ts` with the notice kept). A person can record a
tour in Chrome with nothing installed; an agent can write the JSON; `fromUserFlow`
turns either into steps the recorder runs.

| session step | Recorder step |
| --- | --- |
| `goto` | `navigate` with an asserted navigation |
| `clickOn` | `click` with selectors `aria/Name[role="link"]`, `text/Name` |
| `scrollTo` | `scroll` with the same selectors |
| `scroll` | `scroll` with `y` |
| `pause` | `waitForExpression` resolving after the timeout (so Chrome really pauses) |
| `mark` | `customStep { name: "mark", parameters: { name, kind, label } }` |
| anything else | `customStep { name: "engine", parameters: <the step> }` |

Fields the Recorder has no slot for (`role`, `optional`, `at`, `ms`, `back`,
`settleMs`, and a selector the alternatives cannot rebuild, such as a heading's level)
travel in an `engine` property on the step; a flow written before the rename carries them
in a `vira` property, and `fromUserFlow` still reads that one. `@puppeteer/replay` copies
the fields it knows and ignores the rest, so the flow still replays in Chrome, and the
round trip back to steps is exact — `tests/tour.test.ts` asserts it on every step kind.

## The numbers, and where they come from

| Constant | Value | Source |
| --- | --- | --- |
| `budget.steps` | 12 | Arcade: the best demos have 12 steps; Navattic: 5–13 per flow |
| `budget.ctas` | 6 | recorded product actions across the tour, including prerequisite selections; bounded by the same 12-step cap |
| `budget.pages` | 12 | the page budget of the model-free crawl in the research (Crawljax's idea) |
| `STEP_FLOOR` | 5 | Navattic's floor; the summary says so when a tour is thinner |
| `SCROLL_AT` / `SCROLL_MS` | 0.26 / 1100 | the recorder's own scrollTo defaults, written out |
| `CLICK_AT` | 0.4 | where the hand-written panoma session puts a thing it is about to click |
| `HOLD_MS` / `AFTER_CLICK_MS` / `CHROME_MS` | 1000 / 1500 / 500 | compatibility constants for authored scripts; only chrome uses a fixed pause in new tours |
| `readingPause` | tour 1800–3200 ms; lesson 2600–4800 ms | visible result or section words at 238 wpm plus an orientation breath; bounded capture budget, not a speech-duration estimate |
| area saturation | 7500 px² | ~150×50, a hero button; WCAG 2.5.5's 44×44 floor scores 0.26 |
| first-viewport bonus | +1 | Navattic: 80% of top CTAs above the fold |

## Reading the result

`tourSummary(script)` renders the script as a few English lines — marks in order with
their targets, the calls to action best first with what happened to each, everything
skipped with its reason, and the repairs the mobile re-walk made. It is what an MCP
result carries beside the JSON, so an agent can review a tour without a browser.

## Making one

```ts
import { writeTour, tourSummary } from "@panoma/video-tour";

const script = await writeTour({ url: "http://127.0.0.1:4173/", name: "panoma" });
console.log(tourSummary(script));
// script.steps → briefs/sessions (both takes), script.flow → a .json Chrome can replay
```

## Known limits

- **Products without landmarks or names get thin tours.** No `main` means no section
  anchors and no CTA candidates from content; a button with no accessible name cannot
  be named in a selector. axe-core's `landmark-one-main` and `button-name` rules
  predict this; running them is a possible QA gate, not built.
- **Links that open a new tab are no-ops.** The walker's page does not change, so the
  click is refused as "the page did not change" — which is also what the camera would
  have seen.
- **A modal counts as a new state but not a new page.** The CTA step is kept; no
  section pass follows (the headings are the same page's), and a later navigation click
  may be covered by the modal and refused.
- **The menu step is optional on every take.** If a product renders an `aria-expanded`
  banner button on desktop too (a "Products" dropdown, say), the desktop take will click
  it. Harmless chrome, but a shot the render must skip by role.
- **Mark targets are the desktop take's.** The contract carries one box per mark; the
  mobile layout puts the same thing elsewhere. A renderer aiming a zoom on the mobile
  take should measure again or use the mark alone.
- **Section ordering assumes headings scroll forward.** A page whose h2s are laid out in
  columns can put a later heading above an earlier one; the recorder's back-scroll guard
  will then refuse the step, loudly, and the fix is a hand edit.
- **`[ref=eN]` never leaves the process.** The selector engine that resolves refs exists
  in playwright-core but is not in the public docs, so nothing persisted depends on it.
