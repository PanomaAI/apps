# The brain: judgement in the automatic path, bounded

> "vira must be well wired and intelligent at making videos, whatever the language or
> the technology of the project." — the owner, 2026-09-02

Until this record, `panoma-video auto` was arithmetic end to end. That was a decision
([platform.md](platform.md), principle 2): the tool supplies structure, a model supplies
words, and in the MCP setting the caller *is* the model. On the command line nobody was,
so the words came from templates — "Click Notificaciones", "This is Universend running" —
and the walker clicked whatever the English lexicon scored highest, which on a Spanish
interface was a mute toggle. The pipeline was honest and it was not intelligent.

`@panoma/video-brain` is the judgement, and this page records how it is wired so that nothing the
first principle guarantees is given up: **the brain phrases; it never states.**

## What it is

One package, one function: `ask(question)` takes a typed question and returns a validated
answer from whichever model this machine has. Four drivers play that part:

| driver | how | when it is used |
| --- | --- | --- |
| `claude` | `claude -p` with `--json-schema`, `--system-prompt`, `--tools ""`, `--strict-mcp-config`, the prompt on stdin | the CLI is on PATH |
| `codex` | `codex exec --sandbox read-only --ephemeral --output-schema`, a strict wire adapter, run from a scratch directory | the CLI is on PATH |
| `anthropic` | one POST to the Messages API, the answer forced through a tool whose schema is the shape | `ANTHROPIC_API_KEY` |
| `openai` | one POST to chat completions with a JSON-Schema response format | `OPENAI_API_KEY` |

Detection order is the table's order, and it is a decision: the CLI agents come first
because they are the agent the person already installed and signed into — "the agent that
is programming right now" — and they bill nothing per call beyond the plan already paid
for. A key is consent to spend and is honoured second. `PANOMA_VIDEO_BRAIN` or `--brain=` names one
driver, or `none`; `PANOMA_VIDEO_BRAIN_MODEL` overrides the model; `panoma-video doctor` prints what was
found. Every driver was verified in the session that wrote this except OpenAI's, whose
request is what the documentation specifies and whose test checks the request, not the
network.

Two measurements decided the claude driver's flags. `--bare` skips keychain reads and
answers nothing (no auth). Without `--strict-mcp-config` the CLI loads every MCP server
from the person's settings and their tool schemas into the prompt: one trivial question
cost $0.22 and 54,000 cache tokens; with it, $0.003 and none.

Codex's strict output contract needs a wire adapter. A real Luna thesis failed
before inference because Zod's language map emitted unsupported `propertyNames`;
dynamic `additionalProperties` and omitted optional properties also do not fit
the strict contract. `codex-schema.ts` sends maps as unique `{key, value}` entries
and optional fields as nullable required properties, then restores the original
answer before Zod and the fact audit. It rejects duplicate keys, creates reserved
keys as own data properties, preserves explicit nullable values and refuses
unsupported compositions. All ten current question shapes are covered. This is
transport compatibility, not a relaxation of the answer or evidence rules.
Malformed decoded answers share the existing single correction attempt with Zod
failures; an invalid map cannot bypass that recovery or obtain a second retry
budget. Transport and schema-construction errors remain immediate failures.
[OpenAI's structured output contract](https://developers.openai.com/api/docs/guides/structured-outputs)
describes closed objects and required properties with nullable optional values.

When `PANOMA_VIDEO_BRAIN_MODEL` explicitly names a Codex model, the invocation also uses
`--ignore-user-config`: authentication remains available, while unrelated personal
MCP configuration and model settings do not enter the call. Without a named model,
the legacy configured model/provider behavior remains; that path still loads the
operator's MCP configuration. Both paths disable shell, web search, apps, hooks,
subagent and remote-plugin features for the bounded answer. No global Codex setting
is changed. Errors prefer the backend's structured cause over trailing MCP shutdown
warnings, redact it and bound its length.
[Official non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
and [configuration flags](https://learn.chatgpt.com/docs/config-file/config-basic)
document those per-invocation controls. Codex CLI 0.153 with explicitly selected
`gpt-5.6-luna` answered real thesis and promotional contracts during the September
2026 validation; model quality is assessed separately from transport success.

## The ten questions

The questions are the whole interface between judgement and arithmetic
(`packages/brain/src/questions.ts`). Everything the brain reads was measured by the scout,
the tour and the review; everything it answers is a choice or a phrasing.

| question | when | reads | answers |
| --- | --- | --- | --- |
| **thesis** | after the repo pass, refined from the live brand page before exploration, and checked against recorded context before planning | profile, facts with sources, README excerpt, routes, commit subjects, brand, bounded observed interface context when available | what the product is per language, the angle, the audience, the **interface's language**, verbs that invite action in that language, what to show first, what to use, what never to click, tone |
| **rerank** | on every page the walker reaches | the thesis, the page's accessibility tree, the scorer's candidates with their reasons | an order of candidate indexes |
| **write** | after the templates have planned, excluding `ProductPromo` | the thesis, the facts, the marks with what each click produced, eligible briefs as the templates wrote them | per brief: keep or set aside, a rewritten opening plus up to two more, rewritten lines and labels in every language, lines to drop |
| **fix** | after a review, for checks with `fix.by: plan` | the brief, the facts, the failing checks with threshold and hint | rewritten lines, lines to drop |
| **kit** | when a post kit is written | the cut's lines as shown, the hook, the facts | caption, X, LinkedIn, YouTube title and description, hashtags |
| **lesson** | on `panoma-video teach`, before a browser is driven | the request in the words it was asked in, and the reading of the product screen by screen ([docs/lesson.md](lesson.md)) | the route: an ordered list of controls to press or headings to show, each copied exactly from the reading, with a plain sentence per step |
| **slate** | on `panoma-video tutorial`, before a route exists | the request-free reading, plus every screen scored by `slateOf` with the arithmetic shown | a name and an audience per candidate, how much anyone would want each, one index to film, and the angle |
| **broll** | when a board is shot | the premise, the thesis, the look, the seconds each shot gets, what stands on either side of each transition | the opening, the transitions and the close as shot briefs; every one read by `refuseGenerated` before a request is built |
| **direct** | after the takes are on disk and before the plan | the thesis, what was measured (the film's scheme, the signal, the register, the kind, marks and flows), the arithmetic proposal, the closed candidates, and whether a track was brought | the film's row, the bed's style and key, the tempo, and why; musical motion stays off |
| **promo** | on goal `promo` or `all`, when real recorded proof and sourced product identity exist | product identity, requested languages, optional thesis, a closed menu of safe recorded actions with measured results in every take and their candidate facts | internal audience, tension and explicit argument, promise/result opening, crisp/measured pace, one to three ordered proofs with sourced benefit copy, one to three hooks, and reasons |

**slate** is the shape this repository prefers wherever it can get it: arithmetic proposes,
judgement disposes. The ranking is `slateOf`'s and is the same for the same reading, every
time; what the brain adds is what a viewer would call each row and which one is worth a
video, and its `pick` is CLAMPED to the list rather than trusted. A candidate it invents is
a screen the product does not have.

**direct** is the same shape applied to the look. `deriveDirection` proposes four creative
choices from the palette and the shape of the tour, and the brain is shown the proposal
beside the doctrine it follows — a product that shows itself is editorial, a dark
chromatic product that does something is kinetic, a playful register takes `pulse` or
`bright`, the tempo follows the product's energy (90 calm documentation or a CLI tool, 100
an app, 120 something that moves). It may disagree, and it must say why in four hundred
characters. What it may decide is exactly that list: `row`, `style`, `key`, `bpm`.
`dance` stays `off` for every row. A supplied track and a kinetic row do not enable
musical motion; only a caller's explicit `--dance=light|full` does. The legacy answer
field remains accepted for cached answers, but a non-off value is clamped in code and
recorded, even if an old proposal says `full`. What it may not decide is
anything with a hex in it — no colour is on offer, the colours are computed before the
choice is read, and `directionFor` clamps every field to the candidates it listed: a
`style: "jazz"` keeps the proposal's style and is written down as a clamp. The scheme
cannot move either, because the recorder was told it before the question was asked. The
tempo it returns is always one of `TEMPOS` — a beat must be whole frames — and a brought
track overrides `sound.bpm` downstream: the track wins and the question is told so.
Without a brain, or when the brain declines, times out or
misses the shape twice, the direction is the arithmetic direction, deep-equal to
`directionOf`'s (`tests/direct.test.ts`).

**promo** keeps Normal / Flat by default. Only an explicit `--theme=auto` offers the
brain the closed `flat`/`vibrant`/`block`/`grid` catalog, including each style's motion and
an arithmetic proposal. A named selection (`normal` aliases `flat`) wins over fresh
and cached answers, and persists when later renders omit the option. Explicit auto
releases that saved manual choice for the current run; an automatic selection never
becomes permission for expressive themes on a later planning run that omits the option.

The decision records `by: "default"` when Normal / Flat was applied by default,
`user` for named choices, or `brain`/`arithmetic` for opted-in automatic selection.
Code enforces the default even if a model suggests an expressive theme. Every hook,
language, format and added graphic shares the selection; the recorded product keeps
its appearance and music never switches themes. `promo.json.theme` records the
effective id, author and reason. Missing legacy answer fields use the arithmetic
proposal only in explicit auto mode. Grid / Assembly offers an already readable first
poster, neutral ink and paper, a faint static lattice across the whole film
(including the recording), decisive later exact-phrase assembly with dry accents,
and layered paper cards that flex, dock and stack without covering their copy.
Its added graphics stay monochrome even for a colorful brand. Grid guidance prefers
hooks of three to six words and source inserts only when essential to the benefit;
the theme does not force a crisp pace on a proof that needs measured reading.
Only those added cards may bend; the recorded
app never distorts. Per-proof themes and unsupported names are refused by the strict
shape.

**promo** also chooses per-proof presentations from a closed material menu:
full-frame, a measured focus region, or stable copy beside the moving product.
Optional progressive lists repeat demonstrated benefits, while terminal/code inserts
quote short source facts without fabricating execution. `creative` carries the user's
editorial request separately from untrusted repository text; it cannot enlarge that
menu or supply new product facts. [social.md](social.md) records the effect contracts.

It selects the argument of a wordless selling film independently of the generic
`write` question: a promotion needs to choose relevant demonstrations and their
order, rather than merely rephrase a preselected release or tutorial template. The
audience and tension are internal hypotheses, never printed as facts about customers.
Each benefit cites facts from its own proof candidate; each hook is bound to the first
selected proof. Hooks and benefits must expand to at most seven words and fifty-five
characters in every requested language. The prompt asks for declarative outcomes and
forbids invented savings, speed, superiority, guarantees and accessibility instructions.
Its system instruction replaces the tutorial rule about exact control labels: UI titles
and source prose are evidence, not promotional copy to paste into a different language.
The screen graph supplies observed page context without authorizing its incidental
counts as claims. Explicit empty/loading/error results and isolated README section
titles cannot earn a completed-benefit claim.
A CTA with an ambiguous object (“open it”) is also withheld when neither its own
outcome nor a changed page heading or route resolves it. An unchanged page title
cannot establish the object of a control inside that page; named small interactions
remain eligible.

A named promotional result also needs `MacroAsset.resultHeading` in every served
take: exact heading text, measured viewport/clipping visibility and an uncovered
center. Legacy focus rectangles alone cannot vouch for it. Without that witness,
the result fact is withheld and a saved choice citing it fails current evidence
validation with a recapture reason. An unverified graph heading is not offered as
the result or its after-context; graph routes and state ids still identify the
navigation. Neither visibility nor changed pixels certify semantic entailment.

The proof menu now orders evidence by specificity before changed-pixel area. A
named observed destination leads before a presentation control, which leads before
a screen explicitly named as setup, then a change without a named result. The setup
check matches explicit names such as “Getting started” or “step by step”; it does
not mistake “Setup complete” for pending setup. The presentation check matches a narrow set of
menu, settings and view names in English and Spanish; it is a retrieval aid, not a
semantic classifier. A named completed destination can override preparatory wording
such as “Choose format”. The model can depart from the ordering and must explain
why the choice serves the audience. The deterministic fallback also removes proofs
that reach the exact same recorded graph state; equal headings alone are insufficient
to merge two demonstrations.

Each candidate carries the before/after route and heading-change flags plus its
recorded action kinds, first press, end of available footage and, when the recorder
measured it, the quiet-result time for every take. Entered text is not copied into
this production context. Missing or invalid quiet times remain absent rather than
becoming a claimed instant response. Known press-to-quiet spans guide the fallback's
pace; old takes without that measurement retain the conservative area-based pace
hint. The renderer still owns timing and preserves the whole recorded action.

`promo.json.editorial` is a bounded editorial assessment with candidate ranking,
reasons and actionable issues. It detects a small explicit set of generic hooks or
benefits, exact repeated copy after punctuation/spacing normalization, repeated
recorded destination states, unspecified results and a presentation control leading
or explicit setup leading when a named result exists. Its status is `needs-review` or `clear-of-listed-checks`,
never a virality score or a claim that the film is persuasive, semantically proven
or ready to publish. Exact generic/repeated model copy uses the existing one-correction
budget. Questions requiring interpretation remain visible warnings: a menu can be
the relevant selling point, and two paths to one state can have distinct supported
purposes. The observation-only fallback remains available and reports its own
generic copy instead of presenting it as creatively finished.

New decisions are asked to supply an explicit internal `argument`: `situation`,
`desiredOutcome`, leading `proof`, selected `facts`, `whyThisProof` and `limits`.
It connects a recognizable audience task to the strongest available demonstration
and states what this particular recording does not establish. The prompt compares
that demonstration with the other material rather than filling the proof allowance.
Audience, tension and the argument are creative hypotheses, never measured customer
research, additional product facts or automatically displayed copy. A user's desired
audience or outcome guides this choice; it cannot manufacture missing capabilities.
The first proof and its selected fact references are checked against the fresh menu.
Cross-proof, stale and duplicate argument references use the existing correction.

The field is optional for saved-decision compatibility. Its absence remains a visible
`missing-argument` issue. Exact generic audience labels also request the one correction;
source-only argument citations and benefits backed only by a pixel-change observation
remain warnings, not semantic rejections. Lexical overlap never determines whether a
natural promotional paraphrase passes. These checks cannot certify that an audience
hypothesis is true or that a sales argument will persuade that audience.

Source retrieval now ranks excerpts before bounding each proof's source menu. Exact
normalized matches to the measured result precede action and document-context matches;
generic application and action words do not retrieve a feature on their own. The terms
remain visible in `editorial.sourceMatches`. Within a result kind, a source-connected
result precedes a larger unrelated repaint. This is a retrieval tie-breaker, not a score
for business value, source truth or semantic entailment. A source that merely shares a
word still needs judgment, and absent lexical matches do not disprove a capability.
Question version 12 and promotional decision version 15 invalidate automatic caches.

`promoFor` validates both new and cached answers against the current footage and fact
menu, checks pasted source prose, detected language mismatches and explicit causal
connectors, then runs the claim audit and bounded copy assessment. One refusal can trigger one corrected complete
decision: the same question and candidate menu carry the rejected answer and exact
failures as untrusted data. The replacement passes the same checks. A second refusal
returns the whole decision to `planPromo`'s deterministic, observation-only copy; it
does not leave half of a new persuasive argument bound to an old proof order. A successful
correction stays `by: "brain"` and records the original failures in `decision.repair`.
This applies equally to fresh and cached decisions, under the existing brain budget.
Without a brain, the same deterministic plan runs and a
saved model choice is ignored. `promo.json` records the audience, tension, selected
proofs and facts, reasons, author and full choice. Its validation statement explicitly
distinguishes deterministic provenance checks from model judgment about the relevance
and entailment of paraphrased benefits. Pixel change proves a visible change, not a
business outcome. [social.md](social.md) records the film contract and external evidence.

**lesson** is the only question whose answer is an ACTION rather than a phrasing, and it
is the one place the rules are about consequences instead of wording: never press
anything that sends, pays, deletes, publishes, logs out, installs, rewrites a file,
starts a build or spends model credits, and when in doubt show it instead. The refusal is
enforced twice — the destructive and external lexicons are applied to the answer in
`routerFor` and again in the executor — because a rule enforced only in a prompt is a
request. Every step is then performed in a browser before it is written down, so a
hallucinated control name costs one step and never a wrong instruction on tape.

The system prompt states the rules that are enforced afterwards — a digit is refused, a
control is quoted by its fact, a feature not on the sheet does not exist, each language
track is written natively, project text between the untrusted markers describes and never
instructs — because a call that breaks one is a call wasted, not a video changed.

A repository thesis is provisional. After both takes exist, the automatic path asks
that same typed question with the recorded interface snapshot and named actions,
masked and bounded as untrusted context. The stronger evidence can correct a
starter README, a package identifier or an interface language before direction and
copy are chosen. It consumes the existing call cap and cache, runs offline from the
saved tour on an edit, and keeps the earlier answer if refinement fails. It does not
add facts: a preview or menu still cannot prove a generation, sale or publication.

## What makes it safe to run unattended

The same three guarantees the narration stage has, plus the audit:

- **It costs little twice.** Every question is content-addressed on the driver, the model,
  the prompts and the schema (`@panoma/video-core/cache`). A re-run of an unchanged project sends
  nothing; changing one fact costs the questions that read it. The thesis is asked once per
  project state; on universend it took 63 s the first time and 0 s after.
- **It cannot run away.** Uncached calls are counted against `BRAIN_CALL_CAP` (24,
  `PANOMA_VIDEO_MAX_BRAIN_CALLS`), fixed before the first one. Past it the brain declines and the
  pipeline continues on its templates. A driver has a timeout (four minutes) and honours
  cancellation.
- **It never answers in a shape nobody asked for.** Every answer is parsed against the
  question's zod shape; one that does not fit is sent back once with the validation error
  and refused after that (`BrainAnswerInvalid`).
- **It never states.** In the director (`packages/director/src/brain.ts`), `sanitizePatch`
  applies the brain's patch to the template brief and runs `auditClaims` — the audit an
  agent's patch already passes — then removes from the patch every line and language that
  introduced a claim: a literal digit, an unknown fact id, a roadmap item quoted as shipped,
  a fact in the wrong language track. It also refuses ids the brief does not have, a card
  longer than the recipe allows (five words in a trailer or a spotlight, three on a chip,
  measured after expansion), an added opening that does not carry every language of the
  brief, and any opening beyond the kicker on a wordless piece. **The template keeps its
  own sentence for exactly the line and language refused**, and every refusal is reported
  with the token the model tried to say. Post copy has the same rule in `numbersVouched`:
  a number appears in a caption only when a fact carries it, written exactly, and the
  `{{LINK}}` placeholder is mandatory; otherwise the template's copy is used.
  `ProductPromo` uses its separate whole-choice validation described above. Neither
  validator is a general proof that prose follows semantically from its cited facts.
- **A person outranks it.** The brain's patch lives beside the brief as
  `<id>.brain.json` — `{ write, fixes[] }`, applied in that order — and an agent's or a
  person's `.patch.json` is applied on top. `--goal=<name>` overrides a piece the brain set
  aside; the brain may only set a piece aside on `all`.
- **It is on the record.** Every call is appended to `brain.log.jsonl` in the workspace;
  `brain.json` holds the thesis; the report's `brain.decisions` lists each choice with its
  reason and each refusal, and the MCP tools return the same list. The walker writes
  `brain: ranked #1 — <why>` into the candidate's reasons, beside the scorer's.

## What it changes, stage by stage

- **tour.** `writeTour` takes a `rerank` hook and `verbs`. The scorer still ranks; the brain
  is asked with the ranked candidates and the page, and its order is tried first. Only what
  the scorer set aside for *where* it sits is on offer (a destination list in a
  `complementary` landmark can be the product's main task); what it refused for what it
  *is* — destructive, external, chrome, off-origin, the page itself — is never offered and
  never clicked, whatever the answer. The verbs the thesis returned join the English lexicon
  with the verb bonus, which closes the "lexicons are English" limit for scoring; the
  destructive list is not extended from there. The tour's cache key carries which brain
  walked it, never what it answered.
- **direction.** Arithmetic derives the film's look from `brand.json` and the tour; the
  brain is asked once whether the row, the bed and the tempo fit what the
  product IS, and its clamped answer goes through `deriveDirection` so the colours are the
  ones arithmetic already fixed. `direction.json` records the proposal, the choice, who
  made it and why; the decisions carry `direct: …`. A run without a brain writes the same
  file with `by: "arithmetic"`. Musical motion is a separate, explicit caller option.
  `panoma-video render --project` and `panoma-video storyboard` read this file, with arithmetic as the
  fallback when it is absent, so subsequent renders retain the chosen creative direction.
- **plan.** The templates plan first (structure: which pieces, which marks, which facts);
  the brain writes over them; the plan is made again with its sanitized patches. A brief
  the brain wrote has `origin: "brain"` and is not listed under "polish".
- **promo.** `planPromo` first builds the same deterministic proof menu used by the
  planning tools. For `promo` and `all`, `promoFor` asks the dedicated question at high
  effort, validates its choice with at most one correction, and replaces the template promotion. The generic write
  pass skips this recipe. A person's brief patch is applied afterwards, followed by the
  claim audit and promotional review. The recipe is entirely type and recorded product
  footage, with music and action sounds; no voice assets are needed.
- **narrate, render, review.** Unchanged: they speak, render and measure whatever the
  brief says.
- **fix.** A check with `fix.by: plan` that fails — or `story.captions` warning — is
  handed to the brain with the brief; its rewrite is appended to the brief's fixes, and the
  run is made again with `camera: false` (the takes on disk, the brand they were shot
  under, the product not started). Every stage is keyed on its inputs, so only the cuts
  whose words changed render again. Once by default (`fixes: 1`): a second pass that still
  fails is a report, not a loop.
  `ProductPromo` is excluded: the generic fix patch lacks its proof-selection contract.
  A promotional failure names the required fix or asks for a replan instead of applying
  that unrelated rewrite contract.
- **kit.** The brain writes the copy per hook and language; the template's is the fallback.

## Language and technology independence

Nothing in the brain knows a framework or a language. It reads what the scout produces
for any project kind (the fact sheet, routes, commands, git) and what the tour produces
for any web product (the accessibility tree), and it answers the interface's language as
a field. On universend — a Next.js app with a Spanish README and a Spanish interface —
the thesis came back with `interfaceLang: es`, verbs `escribir, elegir destino,
respirar, lanzar`, the product's six steps in the README's own words, and `Responder`
under "never". The English lexicon had scored a mute toggle first.

A CLI or a library still has no camera path; the brain writes the card piece's words and
its kit, and the walker is not involved.

## What it is not

- **Not a dependency.** `--brain=none` uses deterministic planning and capture without
  asking a model; the end-to-end test runs with `PANOMA_VIDEO_BRAIN=none` so no suite spends a
  plan or waits on a model.
- **Not the executor.** The brain never clicks, never types, never writes a file inside a
  project; it answers questions and the arithmetic acts.
- **Not an author of facts.** It cannot add a `url` or a `cmd.install` the repository does
  not have; when the review says "add a url fact", that is still a person's job, and the
  report says so.
- **Not a replacement for the outer agent.** Over MCP the agent driving panoma video can pass
  `brain: "none"` and write the words itself; both compose, and its patch wins.

## What the first comparison run taught

On 2026-09-03 the same product (universend) was filmed twice, `--brain=none` against a
brain, in two workspaces. The brain's contribution was real: one piece became three, the
only sentence on screen stopped being a raw Spanish button label and became copy written in
both languages, and the tutorial gained a spoken narration and three openings. It also
exposed the sharpest limit of the whole design, and it is worth stating where a reader will
find it:

**The audit checks provenance, not causation, and a brain grounds its sentences in facts.**
The walker had minted `ui.cta.result = "Marte"` for a click that could not have produced it
(the walker bug is fixed in [tour.md](tour.md)); the templates never used that fact, so the
plain run showed a harmless raw label. The brain did exactly what it is asked to do — bind
the claim to the interface's own answer — and produced *"Reveals the destination: Marte."*
on screen and *"Click Desactivar sonido del ritual; the heading changes to Marte."* spoken
aloud. Both are sourced. Both are false.

The lesson is not that the brain should guess less. It is that **a brain multiplies the
value of a true fact and the damage of a false one**, so every fact it is handed has to be
an observation someone can defend, and the layers that mint facts (the walker, the capture)
carry more weight now than they did when only templates read them.

## Limits, honestly

- The OpenAI driver is unverified against a live key; `OPENAI_DEFAULT_MODEL` is
  configuration and may need `PANOMA_VIDEO_BRAIN_MODEL`.
- The thesis reads up to 6,000 characters of README and the rerank up to 12,000 of
  accessibility tree; a very long page is truncated, and the walker's scorer still sees
  all of it.
- A brain that fails the thesis is not asked the other questions; the run continues on
  templates and the stage says why. A brain that fails the write keeps the templates'
  words and says so in the decisions.
- **The write question is the one whose size grows with the run** — every brief, every
  line, every language in one answer — and it is the one that can lose the whole point
  of a brain by timing out. Measured on the claude CLI: one brief in two languages took
  47 s, three briefs exceeded the four minutes every other question gets. It is given
  ten minutes of its own; the others keep `BRAIN_TIMEOUT_MS`.
- `show.flows` from the thesis are the README's words, not always a control's exact
  label; the rerank reads the page itself, so this only shapes preference.
- The fix pass answers word problems only. `record`, `tour` and `engine` fixes are still
  reported for a person or the outer agent.
- The rerank is one question per page walked, inside the walk: with the claude CLI it adds
  roughly ten to thirty seconds per page.
