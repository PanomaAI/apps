# Product promotions: supported value, shown in use

`panoma-video promo` makes a short social product film with concise type, real recorded
actions and music. Its recipe is `ProductPromo`, its goal is `promo`, and its
campaign job is `sell`. There is no narration. The viewer gets a reason to care,
sees the product substantiate it, and leaves with its sourced identity and a
destination when the project supplies one.

The three supplied films informed the editing choices. Their visual and audio
measurements, and the limits of those observations, live in
[social-references.md](social-references.md). This page records the implementation;
it does not repeat that analysis or claim the references demonstrated sales results.

## Run it

```bash
panoma-video promo /path/to/project --langs=es
panoma-video promo /path/to/project --langs=en,es --music=/path/to/music.mp3
panoma-video promo /path/to/project --until=plan --brain=none
panoma-video promo /path/to/project --no-camera --format=h
panoma-video promo /path/to/project --langs=en,es --until=final
panoma-video promo /path/to/project --creative="Explain the release with text beside the product; show a source example only if relevant."
```

In a source checkout, replace `panoma-video` with `node apps/cli/src/panoma-video.ts`. The
command uses the automatic pipeline with `goal: "promo"`. Its default is a vertical
preview of the first hook and requested language. `--format=h` chooses a horizontal
preview; `--until=final` renders the job's vertical and horizontal matrix for all
hooks and languages. `--until=plan` stops before rendering. `--no-camera` uses the
existing recorded takes, without starting or filming the product again.

The usual automatic-path options still apply, including `--url`, `--project` and
`--brain`. `panoma-video auto /path/to/project --goal=promo` selects the same goal; `all`
can include it when the recordings qualify. Outputs stay in the workspace under
`PANOMA_VIDEO_HOME`, normally `~/.panoma/video/projects/<id>`. A missing recorded result or sourced
product identity is reported as a reason the promotion cannot be made. A local or
prelaunch project without a public destination can still receive a promotion:
the final card names the product alone and makes no availability claim.

The planner, not the model, records `promo.close` in the brief and `close` in
`promo.json`: `{ kind: "destination", fact, source }` quotes a sourced product URL;
`{ kind: "brand", fact, source, reason: "no-public-destination" }` quotes the
product name alone. An absent address never becomes a guessed domain, launch date,
repository link or “coming soon” promise. Provider setup pages, framework docs and
loopback preview addresses are excluded. This source check does not claim that a
website was deployed or tested for public accessibility.

Brand-only films have no `end` URL line, placeholder button or arrow. Their
render plan records the same closing decision and reserves a readable identity
card. Captions and post kits omit link-in-bio instructions, `{{LINK}}`, availability
and open-source claims. The post-copy question receives that policy, and a narrow
CTA check rejects conflicting model copy back to the grounded template. Existing
briefs and saved revisions without `promo.close` keep their original URL close;
opening or revising them never silently migrates the story.

`--creative` supplies an editorial request to the promotional brain. It can ask
for an explanation beside the application, a more focused demonstration or a
relevant terminal/code example. Over MCP the same input is `creative_brief`.
The request guides selection and presentation within the measured menus; it
cannot add a product claim, invent an execution result or make an unavailable
focus region valid. Its text participates in the question cache. Without a brain,
the deterministic material-based plan still runs and does not interpret prose.

`--music` supplies accompaniment. It is measured and conformed to the frame-aligned
beat grid through the existing [music pipeline](music.md). It does not enable
musical camera motion. Interaction effects follow recorded presses, scrolling and
typing inside proof footage; a preview of an already completed result does not
replay its click sound. The recipe carries its complete argument when muted.

## One theme per promotion

Normal / Flat is the default. Themes style graphics panoma video adds. Grid also adds a
faint static lattice across the whole film, including recorded footage. The source
recording keeps its original pixels, geometry and motion. A brain may choose wording and proof
without acquiring permission to make the film expressive. With no theme option and
no saved explicit user choice, `themeFor` returns `flat` with `by: "default"`, even
when a fresh or cached brain answer asks for vibrant, block or grid.

`panoma-video themes` is a local catalog of the finished systems and their motion:

| ID | Name | Visual character | Motion |
| --- | --- | --- | --- |
| `flat` (`normal` alias) | Normal / Flat | Quiet surfaces and a clear reading hierarchy | Stable poster, gentle whole-title settle, quiet list reveals |
| `vibrant` | Vibrant | Strong color fields, compact panels and decisive accents | One title rise with a baseline sweep; quick row arrivals |
| `block` | Block-based | Rounded panels, bold outlines, solid offset bases and button-shaped close | A title stamp, one mechanical button press, source and row docking |
| `grid` | Grid / Assembly | Monochrome ink and paper, fine static lattice across the whole film and layered editorial cards | Readable first poster; decisive exact-phrase assembly with dry accents, then holds; paper cards flex, dock and stack without covering copy |

Each theme is a complete graphic system. Cards, side text, recaps, terminal/code
panels and their accents share it throughout the film and every hook, language and
format. Focus, full-frame and split remain composition choices inside that system.
A theme never changes with the music, recolors a recorded app or requests a new
capture scheme. Glass and clay are not offered in this release.
Grid's added graphics always use neutral ink, paper and gray rules, even for a
colorful brand. Its side copy and documented source sit on quiet paper faces;
color remains in the actual recorded product. The brain prefers concise hooks
of three to six words and selects a source insert only when essential to the
benefit, never to fill time or showcase an available effect. The selected pace
still follows how much time the recorded proof needs to be understood.

`--theme=normal|flat|vibrant|block|grid|auto` is available on `panoma-video promo` and `panoma-video auto`.
MCP `panoma_video_auto`, `panoma_video_plan` and `panoma_video_render` accept the same `theme` input. Named
choices win over both fresh and cached brain answers, and a saved `by: "user"`
choice persists when later plans/renders omit the option. `normal` normalizes to
canonical `flat` before the brief and decision are saved. `--theme=normal` explicitly
returns a project to Normal / Flat.

Only explicit `--theme=auto` opts into choosing an expressive theme from context.
It releases a saved manual choice and offers the brain the closed catalog, with
one reason for the entire film. Arithmetic proposes vibrant only for a crisp
web-app demonstration with an expressive register: a playful thesis, or a chromatic
kinetic direction without a technical/formal thesis. Dense measured explanations
keep flat; block and grid can be chosen deliberately by the caller or by the opted-in
brain. Grid uses displaced groups of the exact phrase, preserving its meaning and
settling before the reading hold. Its card flex and stack treatments belong only to
added editorial graphics: the recorded app never bends or distorts.
An automatic choice is not retained as permission: a later planning run that omits
the option returns to Normal / Flat, unless a user subsequently saved a named choice.
Direct `panoma-video render` of an existing brief preserves that film's saved theme; it
does not make a new selection.

Unsupported or per-proof themes fail the strict contracts. Old brain answers that
omit the theme use the arithmetic proposal only when auto was explicitly requested;
otherwise they stay Normal / Flat. Authored briefs without `promo.theme` stay flat.
Invalid values fail before scouting or model calls; other goals reject the option,
while `all` applies it only to ProductPromo.

`promo.json.theme` records `{ id, by, why }`, where `by` is `default`, `user`, `brain`
or `arithmetic`. `choice.theme` records the effective selection, and the compiled
brief stores the single `promo.theme`. No theme field exists on a proof, insert,
hook or language. The render plan also records `editorialTheme`; review refuses a
plan from a different selection. Vibrant uses the chromatic brand accent when
available and an explicitly editorial lime for a neutral identity. Editorial colors
never enter the recorded product; the source action clock stays unchanged.

```bash
panoma-video themes
panoma-video promo /path/to/project                         # Normal / Flat by default
panoma-video promo /path/to/project --theme=block --no-camera
panoma-video promo /path/to/project --theme=grid --no-camera
panoma-video promo /path/to/project --theme=normal           # return to Normal / Flat
panoma-video auto /path/to/project --goal=promo --theme=auto --until=plan
```

### Motion belongs to the theme and the editorial role

A theme now defines typography, geometry, accents and a finite movement vocabulary.
The same piece cannot choose a Block stamp for one title and a Vibrant sweep for
the next. Normal remains the primary presentation. Explicit alternatives apply to
the whole promotion; no motion setting reaches the captured product.

`PromoTitle` draws complete copy from the cut. A first-frame card stays fully settled,
so the feed poster is already the finished composition. Later dedicated titles
enter in 200 ms (Normal), 300 ms (Vibrant) or approximately 360 ms (Block), rounded to
whole frames, then stop completely. Grid assembles at most three exact phrase
groups, each moving for 220 ms; fewer groups at slow tempos keep the total at or below
500 ms. Its displaced word slots are reserved from the cut and reading starts
after assembly. The [Grid reference and implementation](grid-motion.md) document
the static film lattice, card flex and shared sound clock.
Their timing lives in `timing.ts`; the planner
adds entrance time before snapping the card duration to a beat. `cards.readFrom`
and the declared hold use that same settlement frame, and the reading review
rejects an entrance that leaves too little readable time or invalid timestamps.
These durations are authored editing choices, not claims of experimentally optimal
engagement or guaranteed reach.

Vibrant now concentrates its accent around the title baseline, content-sized side
panel and closing destination, instead of unrelated corner bars and an extra code
edge. Block follows the supplied 2026-09-05 reference's thick contours, consistent
rounding and hard bases. A dedicated `BlockPlate` draws two solid SVG planes;
there is no blur or lighting filter, and the layout reserves the offset. During a
press, text and face share the same travel. Its wider headline face is the already
vendored Anybody font; code retains Geist Mono and the exact source characters.

Source panels arrive during the existing empty lead, before typing starts. The
renderer also forces the panel to rest whenever any source character is visible.
Split explanations stay still for the entire real demonstration. A recap moves
only its incoming row; established rows do not bounce when the next one arrives.
The close can present the sourced destination as a button, without adding an
invented offer, pointer action, execution result or new product capability.

Customizable motion graphics already exist, including [Adobe's motion templates](https://helpx.adobe.com/ca/premiere/desktop/add-text-images/use-motion-graphics-templates/customize-motion-graphics-templates.html).
panoma video's design objective here is a coherent automatic system bound to real product
evidence, format constraints and verified reading time. This is an implementation
direction, not a claim that no comparable system exists.

## Who decides what

The scout supplies product facts and sources; the tour names actual controls and
observed destinations; the recorder supplies events and measured image changes.
`promoCandidates` in `packages/director/src/promo.ts` turns them into a closed menu.
A candidate must meet every requirement:

- Its tour mark is a safe CTA or product flow, outside the chrome, destructive and
  external control lists.
- Every supplied take contains that mark and a product click before the next mark.
- Every take has a same-origin macro with a finite, positive changed-pixel share
  and a valid changed region. A section scroll alone earns no promotional proof.
- The observed result heading is not an explicit empty, loading or error state.
  This is a narrow status check: a setup heading such as “Power the product on,
  step by step” remains a setup screen, not a guessed loading state.
- An ambiguous CTA such as “More places to open it” needs its own observed outcome
  or a distinct page heading or route. An unchanged catalogue heading does not
  identify what “it” refers to. Without that evidence, the control is withheld
  until its target context or result is recorded. Named actions such as “List
  view” and small menu changes remain eligible; area alone is not a value test.

A long accessibility label does not disqualify real footage. A control named with
an instruction such as “Open … — or double-click” can therefore provide a useful
action while its gesture hint remains unavailable as quoted copy.

Each candidate offers its `ui.<mark>` and `ui.<mark>.result` facts as evidence, plus
lexically related README descriptions, package-description or shipped-feature facts. Simple
plural variants help retrieve a description of “projects” for a “Project” result.
Retrieval is only a suggestion of relevance. It does not establish that a click
proves every clause in a retrieved sentence. When no suitable name exists, the
fallback uses a localized, sourced observation of visible change.

The tour's screen graph supplies before/after page headings even for an action
whose mark has no outcome heading. This context lets the model understand a change
of catalogue layout or a list of work needing attention. Incidental counts remain
context and are not promoted to quotable numeric facts. README titles and section
headings alone are excluded from behavior evidence: a heading about isolation
cannot explain why a proposals screen happens to be empty.

`planPromo(input)` is the synchronous deterministic path used by planning tools.
It prioritizes named observed destinations before presentation controls, explicit setup screens and unnamed
visible changes, using changed-pixel area only within an evidence tier. The menu,
settings and view-name check is a narrow retrieval signal, not a semantic classifier:
preparatory control wording can still lead to a named completed result. Repeated
destinations are omitted only when the tour recorded the same graph state; equal
headings alone do not merge demonstrations. It selects up to three proofs and uses
observed names for the copy, without deriving a business benefit from pixel change.
`promoFor(brain, input)` starts from the same plan, then
asks the separate `promo` question when a brain and sufficient material exist.

The brain sees each action's before/after context, action kinds and recorded timing
in every take, including the optional press-to-quiet measurement. Typed user text is
not added to that context. Unknown settling remains unknown; none of these internal
timings becomes a performance claim. Known result timing informs the fallback's
pace, while older takes retain the conservative area-based pace hint. The renderer
always owns the action clock.

The event log must also share the recorded video's origin. Capture version 17
measures it from the first screencast presentation timestamp and writes
`SessionLog.videoClock`; the stored event times already include that correction.
`recording.clock` warns when a video take lacks this evidence and names recording
as the fix. The automatic recorder invalidates earlier capture versions. This is
separate from `promo.cause-and-result`, which checks the planned logged action and
result span: structural arithmetic cannot confirm that a navigation remains visible
in an encoded cut. A new-app trial exposed that distinction when an older clock
placed its source start after the actual navigation. The encoded file still needs
visual inspection; calibration metadata is not semantic proof of every frame.

`promo.json.editorial` reports candidate ranking, reasons and a limited checklist:
generic or repeated copy, repeated recorded states, unspecified results and a
presentation- or setup-first opening when a named result is available. Exact generic and
repeated model copy gets the same single correction as a validation refusal.
Interpretive concerns stay visible warnings, allowing an intentional menu-focused
argument. `needs-review` and `clear-of-listed-checks` describe only these checks;
they never certify persuasion, semantic entailment, professional quality or reach.
The deterministic fallback remains available and reports its generic copy honestly.

A named result needs the recorder's exact `resultHeading` witness in every served
take: matching text, at least 90% visible area, an unobstructed center and a box
inside the viewport. A graph title describes a document and does not prove what
the selected shot shows. Without the witness, the candidate loses its result fact
and result context; the refusal names the takes that need recapturing. Cached
choices and saved revisions citing that fact are checked against the same fresh
menu. Legacy `focus` rectangles alone do not pass, and no saved file is silently
stamped or rewritten to make it pass. This closes the case where a product-detail
shot was described as recommendations that only appeared after a later scroll.
It proves geometric visibility, not the truth of every model paraphrase.

For a new story, the model also supplies an internal argument in `promo.json.argument`:

```ts
{
  situation: string,
  desiredOutcome: string,
  proof: string,
  facts: string[],
  whyThisProof: string,
  limits: string
}
```

This makes the proposed selling logic reviewable: the viewer's particular task,
what they want to recognize, the first demonstration that supports it, and what
the material does not establish. `proof` must be the first selected proof and
`facts` must belong to its selected, currently available evidence. These references
are checked for fresh and cached answers. The free prose is editorial reasoning,
not customer research or extra product facts; none of it is automatically printed
in the film. User audience and outcome requests remain directions within these
evidence boundaries. A recording of inspection cannot become proof of an unseen
transaction because the user requested that outcome.

The optional field keeps old saved choices readable. Missing arguments, exact
generic audiences, source-only argument citations and observation-only benefit
evidence appear in the bounded editorial checklist. Only exact generic audience
patterns and invalid references request the existing single correction; source
interpretation remains a warning. A complete argument can still be unpersuasive.
A later manual revision can also change the original argument's proof order: the
saved model argument describes its original proposal, not a newly validated sales
strategy for every subsequent edit.

Related source excerpts are ranked before the six-source limit. Meaningful terms
shared with the visibly measured result precede action and document context;
generic words such as open, application or screen do not retrieve a product claim.
`editorial.sourceMatches` records the matched terms for each offered source. Within
the existing result-kind order, source-connected results precede unrelated large
pixel changes. A shared term is only a retrieval signal: it does not establish
that every sentence in the source was demonstrated. Nor does missing overlap
invalidate a natural paraphrase. Fixtures exercise these boundaries for a tool's
report, a project's saved context and an item's size chart; they do not measure
customer response or prove coverage of all real applications.

The model chooses an audience and its tension as internal creative hypotheses,
an opening, a pace, one to three proof IDs in order, and localized hooks and
benefits. Each benefit carries evidence IDs from its own candidate and an
explanation of their relevance. Every hook is bound to the first selected proof.
Benefits describe an outcome for the viewer; the prompt rejects tutorial language
and warns against implying that independent demonstrations form one workflow.
Showing a menu of launch choices proves those choices were shown; it does not
prove that a project or application launched. A completed useful state is preferred
over a generic menu whose proposed action never happens on camera.
The promotion has its own system instruction. It does not inherit the tutorial's
requirement to quote control labels exactly: source prose and UI titles belong in
evidence, while the benefit is phrased naturally in the requested language.

This is a dedicated writing contract. The generic `write` question skips
`ProductPromo`, whose opening and benefit choices would otherwise be constrained
by another recipe's furniture. The existing `direct` question still selects the
broader creative direction; `promo` cannot choose a new colour, invent footage or
edit a source timestamp.

The question also chooses presentation from the material available. Each proof's
closed `treatments` menu always offers `full`; `focus` is offered only
when every take has a visible, bounded changed region. New automatic plans offer
`split` only when the actual settled result framing preserves at least one output
pixel per source CSS pixel in every served format. The check shares the recipe's
panel layout, measured result, camera fit and file-density ceiling. Its numerical
decision is recorded in `promo.json.presentation`: a large recorded page cannot
be made suitable for a small panel just by recording more pixels. This limits
additional miniaturization and does not certify text legibility. Explicit scene
revisions still offer split, and existing split briefs remain valid.
Source inserts have their
own closed menu: exact command or code facts with a source, at most eight lines,
seventy characters per line and four hundred characters overall. Control
characters and language-incompatible excerpts are excluded. A model chooses at
most two of these excerpts and the selected proof each follows; it cannot supply
terminal contents or generated code as part of its answer.

## The film's structure

The conceptual argument is **audience tension → supported benefit → actual proof
→ invitation**. Audience and tension remain in the decision record; they are not
automatically printed as claims about customers. The implemented sequences are:

| Opening | Sequence |
| --- | --- |
| `promise` | Hook card → real action and result → benefit card → further selected proofs and benefits → sourced close |
| `result` | Brief preview of the first recorded result → hook card → that result's real action → benefit card → further selected proofs and benefits → sourced close |

When the first benefit repeats the hook, its redundant card is omitted. Full-frame
cards and footage take turns owning the frame; `split` is an explicit, separately
composed exception requested by the owner on 2026-09-05. The closing card combines the sourced product
name and URL when available, or the name alone; the system does not invent a
discount, availability date or offer.

### Presentation vocabulary

- **Full product:** the whole interface retains its context, followed by its
  benefit card. This remains the default for an older brief with no treatments.
- **Focus:** the real measured result stays clear while its surrounding pixels
  are dimmed. The rectangle comes from `MacroAsset.change.box`, not inferred
  geometry or a generated copy of the interface. It must lie wholly inside the
  recorded viewport, measure at least sixteen pixels on each axis, occupy at most
  ninety percent of either viewport dimension and at most seventy-two percent of
  its area, in every take. These are conservative layout bounds, not perceptual
  research claims. A near-full-page change remains a full or split proof.
- **Split:** one concise benefit has its own panel beside the moving application;
  the layout adapts the two panels to the available format. The benefit stays
  stable while the action completes. It does not repeat as a full-frame benefit
  card afterwards. This is useful when a changed behavior or version needs an
  explanation adjacent to its demonstration. It does not permit text across an
  active control or weaken the evidence requirement.
- **Progressive recap:** the selected benefits arrive as a short list after their
  real demonstrations. The copy is reused exactly, with at least two distinct
  proofs required. A check or arrival refers to the demonstrated benefit, never
  to an invented background process, completed generation or successful test.
- **Terminal and code inserts:** a sourced command or code example is revealed
  progressively on its own stage. The text is the verbatim source fact; no command
  is run for this effect, and no terminal output, success state or behavior is
  fabricated. The final characters receive a separate reading hold. Inserts are
  explanatory material and do not count as recorded product proof.

The deterministic fallback isolates a result when its geometry permits, otherwise
uses a split explanation for the leading proof when that scale check passes,
and full footage otherwise and for subsequent
proofs. It adds a progressive recap when two or more proofs were selected. It
does not guess which command or code excerpt is commercially relevant: inserts
require a model choice or an explicit brief. The model can omit any optional
effect when it adds repetition or distracts from the actual result. This is a
reusable vocabulary, not a demand to show every effect in every film.

`crisp` and `measured` change reading allowance. The planner accepts at most seven
expanded words and fifty-five characters per hook or benefit; the renderer then
sizes each card's duration from its actual text and rounds to whole beats. A
promise opening must reveal the product within three seconds. That is a house
editing target, not a platform requirement or a research-derived optimum.

Proof length follows the recording. A new take's measured `resultAtMs` can end a
demonstration after the result has arrived and been readable, without importing a
tutorial's entire reading pause. With no trustworthy result timestamp, the plan
keeps the source segment. It preserves recorded action and latency, conforms the
take frame for frame, and widens to include scrolling that crosses a proposed
entry point. The camera travels to a relevant control or measured result and then
holds. The timing arithmetic is shared in
`apps/render/src/recipes/timing.ts`; the scene only renders it.

The structure has deliberate limits: two opening modes, two pacing choices, three
proof treatments, an optional recap, at most two source inserts and up to three
demonstrations. It is not an unrestricted film editor, a simulated
customer journey, a testimonial generator or a guarantee that every product gets
an entirely new visual grammar.

Consecutive split demonstrations retain the same composition while their copy and
source change. Their starts remain beat-aligned named chapters in the plan; they
do not declare a visible change of ground as though a new full-frame shot arrived.
Terminal/code typing and progressive recaps declare their entire span as authored
type, including the pauses between arrivals. The separate text plan still checks
reading time after the content is fully visible. A focus veil fades linearly over
300 ms so its first frame does not create an unintended luminance cut.

The presentation pieces share a restrained finish. A focus aperture adds at most
two source pixels around the measured component; its camera moves closer only
within the recording's pixel density and the complete result's bounds. Stacked
layouts reserve a compact copy region so the real mobile take can occupy more of
the safe stage without changing its aspect. Recap rows share a compact text column
and connecting rail: a check draws over 220 ms after the row settles, while all
previous phrases keep their positions and weight.

Source panels fit their content rather than stretching a short command across
the stage. Terminal and code have distinct chrome; code includes a line gutter,
contrast-checked syntax and a temporary active line. These are typesetting aids,
not additional source content. The panel lands complete, waits 200 ms before the
first character, then reveals the verbatim example on the same clock as its key
sounds. Every character reserves its final position from the first frame; the
complete example receives its own reading hold.

## Evidence, audit and the decision record

`promo.json` records the decision version, `by`, audience, tension, opening, pace,
selected proof IDs and facts, reasons, the full choice and a statement of the
validation limit. The brief stores the rendered contract in `brief.promo`:

```ts
{
  opening: "promise" | "result",
  pace: "crisp" | "measured",
  evidence: Record<lineId, { mark: string; facts: string[] }>,
  treatments?: Record<benefitLineId, "full" | "focus" | "split">,
  recap?: boolean,
  inserts?: { kind: "terminal" | "code"; line: string; after: benefitLineId }[]
}
```

Every hook and benefit has an evidence entry. All hooks and lines use `mode:
"type"`; `brand` names the product and the optional `end` references its URL. Model choices
are parsed against `PromoShape`, then checked against the current candidates.
Unknown or duplicate proofs, facts borrowed from another proof, unbound quoted
facts, pasted source prose or UI titles, missing tracks, detected foreign-language
copy, explicit unobserved causal links, forbidden instruction or performance language, and
unreadable copy refuse the proposed choice. `auditClaims` additionally checks literal digits, unknown references,
non-facts and fact languages. Refusals are returned by ID and enter the automatic
run's decisions.

Each insert points to an unmarked brief line containing exactly one
`{{fact:id}}` reference, with the same source in every language. Its `after`
field names a benefit line; model decisions name the proof mark and compilation
resolves it to that line. An insert cannot borrow a prose fact, append a success
message, replace the command, repeat an excerpt or point at an absent proof.
Presentation choices are optional in the answer schema so older saved decisions
remain readable. They are still revalidated against the current geometry and
source menu; the new question and decision versions invalidate automatic caches.

One correction is allowed. The same `promo` question receives the previous answer
and its exact refusals as untrusted data, alongside the unchanged candidate menu
and constraints. Its replacement is parsed and validated in full. A second refusal
or failed correction leaves the deterministic plan; there is no correction loop or
relaxed claim rule. An accepted correction remains `by: "brain"`, and
`decision.repair` records the initial refusals and whether the correction passed.
The run's refusal history is retained even when the correction succeeds. This is
at most two promotional decision requests, using the brain's existing shape
validation and call budget.

Fresh answers and cached answers receive the same validation and single correction
opportunity. An explicitly supplied cached refusal needs only the correction
request. Candidate generation
rebuilds generated UI and observation facts from the current tour and deduplicates
IDs. An unchanged brain input can use the brain's content-addressed cache;
`--brain=none` ignores a supplied saved choice and uses deterministic planning.
The automatic path applies a person's brief patch after the model choice and runs
the ordinary claim audit before rendering.

The promotional review separately checks one to three distinct demonstrations,
wordless copy, evidence references against a freshly recomputed candidate menu,
a product click and measured result in every
take, a sourced close, and the render plan's action/result windows. It also checks
early product visibility and readable cards. Encoded-file review still measures
the picture, cuts, loudness and platform conformance.

Effects have their own review boundary. `promo.treatments` checks measured focus
eligibility in every take and refuses a one-item recap. `promo.source-inserts`
validates exact source-only insert lines separately from proof counts.
`RenderPlan.texts` records each split explanation, recap row and typed source
excerpt, including the frame at which all its text is readable. Review requires
the planned text to match its expanded brief line, requires every requested
effect to appear, and checks at most twenty-four characters per second after
arrival. A long typing animation does not count as a readable hold of its final
line. `RenderPlan.uses[].treatment` also records that the selected proof treatment
was actually planned instead of silently dropped.

`reviewPromoLayout` measures the actual composition HTML in the same Chromium
rasterizer used for export. It checks the exact settled entrance frame, the middle
of the reading hold and its last frame against the platform-safe Stage. Shared
recaps wait until every overlapping row has settled; source panels wait until
typing completes. The opening poster and final closing frame are included.
`layout.overflow`, `layout.outside` and `layout.collapsed` report clipping-container
overflow, text crossing safe bounds and empty text boxes with scene ids, frames,
seconds and an `engine` fixer. Missing clocks, reading spans or renderable material
cannot produce a passing measurement. Only the actual `ProductWindow` in a
promotion opts into `data-lint="ignore"`: its deliberate camera crop and recorded
browser chrome are not editorial DOM text. The adjacent split explanation is
still checked. This sampled geometric audit cannot judge text inside recorded
pixels, readability of image contents, motion between samples or aesthetic quality.

Review refuses a fact that exists on the sheet but is not offered for its selected
mark; every hook must name the first demonstration. An absent candidate menu is a
failure, not permission for a patch to supply its own evidence. Promotional
failures do not enter the generic `fixFor` rewrite pass: its patch contract does
not carry this proof menu. Follow the named fix or replan the promotion; automatic
generic copy repair remains available for the other recipes.

These checks establish provenance and physical evidence boundaries. They do not
prove semantic entailment: a source mentioning project notes plus a changed panel
does not mathematically establish a promise about saving time. The model judges
the relevance of a paraphrased benefit, and its reason is recorded for review.
The restricted-phrase check is intentionally limited, not a complete detector of
all possible unsupported claims. Language detection on very short prose is also
limited; it is not a substitute for reading the finished copy. Audience fit, emotional clarity, recall,
conversion and commercial effectiveness are not measured by a passing render.
The referent check is similarly conservative: it catches selected English and
Spanish pronouns and requires better evidence, rather than inferring the target's
meaning from a page title. Full DOM context for the target and its changed result
is not yet part of this promotional decision contract.

## External evidence informing the choices

Sources were checked on 2026-09-05. They inform editorial choices and do not
certify panoma video's outputs or supply facts about the product being filmed.

- Google's current ABCDs guidance favors an early focused message, product
  demonstration for consideration, and tangible value before a specific ask.
  panoma video uses that as support for selecting a coherent benefit and showing its
  proof before the close. Its wordless format is a product choice; Google's
  broader guidance also discusses voice reinforcement.
  [Google Ads: ABCDs of effective video ads](https://support.google.com/google-ads/answer/14783551?hl=en).
- TikTok's Creative Codes describes hook, body and close while explicitly
  presenting its illustrated sequence as nonprescriptive. It distinguishes
  music setting mood from effects reinforcing actions. The often repeated
  **90% within six seconds** figure concerns **ad recall impact**, attributed
  to TikTok's 2020 Value of View analysis. It is not a claim that ninety percent
  of viewers remain, that retention is determined in six seconds, or that those
  seconds produce ninety percent of sales.
  [TikTok Creative Codes, May 2023, pages 4–6](https://ads.tiktok.com/business/library/TikTok_CreativeCodes_May2023.pdf).
- Google's 2015 analysis of skippable ads associated early branding with higher
  recall and awareness but also more skipping, and favored product-associated
  branding over detached logos. These are different outcomes, from an older ad
  format and observational analysis. They support testing the opening's job;
  they do not establish a universal logo-first or music-first rule for current
  social software films.
  [Google: The First Five Seconds](https://business.google.com/ca-en/think/marketing-strategies/creating-youtube-ads-that-break-through-in-a-skippable-world/).

The enforceable boundaries are covered by `tests/promo.test.ts`,
`tests/promo-review.test.ts` and `tests/promo-scene.test.ts`. They verify the
implementation's promises, not future audience response.
