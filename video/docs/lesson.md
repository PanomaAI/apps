# Lesson

> "Make me a tutorial about how to manage the .md files of my projects."
> The product goes in with the question; the video comes out having answered it.

Everything else panoma video makes is about what a product IS. A lesson is about how to do one
thing in it, asked for in words, in any language. It is the same pipeline — the same
recorder, the same narrator, the same review gate — with the walk replaced by a reading
and a route.

```bash
panoma-video teach "how to manage the .md instruction files your agents read" ~/code/panoma --url=http://127.0.0.1:4173
```

## When nobody says

```bash
panoma-video tutorial ~/code/panoma --url=http://127.0.0.1:4173     # and nothing else
panoma-video tutorial ~/code/panoma --slate                          # the menu, without filming
```

A tool you have to know how to ask is a tool for people who already know the product. So
the reading is scored, screen by screen, on five terms it can measure — and the ranking is
arithmetic's, not a model's, which is what makes it a thing to argue with rather than a
mood.

| Term | Weight | What it measures | Where it comes from |
| --- | --- | --- | --- |
| **payoff** | 3 | Getting there produces something. A screen reached by pressing a control on the page you were standing on is an action; one reached by a link to another route is a place, and scores 0.6 of it. | MacLeod, Bergen & Storey's study of developer screencasts (*Empirical Software Engineering* 22:1478, 2017) derives "show by doing" from producers directly |
| **focus** | 2 | Sections of its own, against the busiest screen read. A product's "everything" view contains every word its focused views contain, and a video about it is a tour. | the same study's "stay on topic" |
| **reach** | 3 | Doors to get there. Two to four is a video; one is a screenshot, and past five it is a manual. | Navattic's and Arcade's published step counts for demos that perform |
| **procedure** | 2 | How many steps the lesson would actually have: the doors, plus what there is to show once you arrive. One is a screenshot, two is thin, three to six is a video. | Nielsen Norman: people turn to video for the complex, unfamiliar and **multistep**, and read text for the rest |
| **safety** | gate | A screen only reachable by pressing something on the destructive or external list is not a candidate at any score. | — |
| **payoff > 0, steps ≥ 2** | gate | Two hard gates before the score is looked at. | a scalar floor alone is clearable by a screen that is well written and teaches nothing |

**What is deliberately not a term: the screen's own copywriting.** The first version of this
scored a screen higher for asking a question or stating a figure — the product giving a
viewer a reason to care. That is a reason to *click*, and the evidence for it measures
clicks (Lai & Farbrot, 2014: +150% on question headlines, +175% self-referencing) while
every length and completion finding measures retention. The two optimise against each
other, and a well-copywritten screen that teaches nothing would have outranked a plain one
that teaches something. The question and the figure are still read — they choose the
ANGLE — and they do not touch the ranking.

The slate is then **thinned to a menu**: at most two rows per address, because ten views of
one page is the same video ten times. And it has a **floor** (`SLATE_FLOOR`, 4.5): under it
panoma video says the product has no tutorial in it and diagnoses why — behind a sign-in, one
screen only, or nothing that changes when you press it. A tool that always produces a video
produces bad videos.

A brain is then handed the ranked menu and does the only part arithmetic cannot: it names
each row the way a viewer would ("get back into a project you left months ago", not "the
Resume tab"), scores how much somebody outside the product would want it, and picks. It may
prefer a lower-scoring row and has to say why. Without a brain the top row is filmed, which
is defensible precisely because the ranking is not an opinion.

### The angle

The framing is chosen from the material and it changes exactly one line — the hook.

| Angle | Chosen when | The hook is |
| --- | --- | --- |
| `objection` | the screen asks a question | that question, asked back at the viewer |
| `count` | the screen states a figure | the figure, closing the sentence (never a word inflected after a digit) |
| `speed` | two doors or fewer | how little there is to it |
| `contrast` | — | what somebody does instead today |
| `how-to` | nothing else applies | what the viewer will be able to do, plainly |

Five, closed, each tied to something the material had to contain before it could be chosen.
A sixth invented per piece would be a mood, and a generator with moods produces five
tutorials that all open "Ever wondered…".

An example, unedited, from the first autonomous run against panoma — the arithmetic ranked
seven screens, and the brain wrote:

> "Every developer with a folder they abandoned knows the dread behind the question the
> screen asks itself… Accounts & links scores the same and asks its own good question, but
> it teaches a narrower fix for a rarer moment, while the others are either empty states,
> settings, or lists rather than something a viewer does."

## Why the walker cannot do this

`@panoma/video-tour` explores breadth-first and stops when its budget is spent. That is the
right machine for a film that sells and the wrong one for a question with a
destination: asked for a tutorial about one panel, a walk films the front door. Two of
its rules are deliberate blind spots for this purpose, and both had to be inverted
rather than relaxed:

- **It follows the primary navigation, not content.** A tutorial about projects happens
  on a project page, and a project page is reached from a tile in a grid — which on a
  real application is a `button`, not a link. A reading that follows only `href`s
  reports that the product has no projects in it.
- **It refuses a link that points at the page it is on** (`score.ts`, `samePage`), which
  is right for a tour — a jump link films as nothing — and blind for a reading: a tab
  strip written as `<a href="#md">` is how a large part of a product's surface is
  reached, and none of it exists in a walk.

## Three stages, and only the middle one may involve a model

### 1. The reading — `readAtlas` (`packages/tour/src/atlas.ts`)

Opens the product and writes down what it is made of: every screen it can reach, the
heading of each, its section headings, its running text, every control by the name the
interface gives it, and — for a screen reached by pressing something — which control
opened it. Nothing is filmed and nothing is chosen.

Three things make it terminate on a real application:

| Problem | What the reading does |
| --- | --- |
| 32 projects look like 32 screens | Addresses are grouped by **path shape** (`/p/*`) and only the first couple of each is opened. |
| The page behind a list is behind a button | **Collections**: controls in the same part of a screen whose names open and close with the same words are one control repeated over data. Three of a kind is a collection, and the first is opened, once. |
| Fifteen navigation links before the first project | With a subject, the queue is **best-first**: a link whose name or address shares words with the request is opened first, and an address reached by a press this reading already chose is raised to the front of the queue. |

Two failures paid for in the making, both worth keeping written down:

- **A press that routes on the client leaves the network idle immediately.** `settle`
  therefore returns at once and the snapshot is the old page plus a spinner, so the
  press reads as a view of the screen it left — measured on panoma, where pressing a
  project tile recorded the catalogue under the project's name on some runs and not
  others. `settled()` samples until two samples agree, which is the only test that does
  not need to know how the product is built.
- **A press that goes somewhere with an address of its own is a navigation, not a
  view.** Recording it in passing produced the same page twice, and the copy with no way
  in was the one that got explored. It is queued instead, and read on its own turn —
  which is the turn where its own views get pressed.

### 2. The route

A brain reads the reading (`atlasText`, which folds the furniture that is on every
screen into one line and collapses a list of thirty-two into "and 31 more of the same
shape") and answers with an ordered list of NAMES. Nothing executes here, and a name
that is not in the reading is refused before a browser is opened.

Without a brain, `routeFromWords` matches the request's words against the reading. It is
the fallback and it says so: the route is the **chain of doors** to the best-matching
screen, followed by that screen's headings as things to SHOW. Two tie-breaks matter more
than they look — a product's "everything" view contains every word its focused views
contain, so on text alone the catch-all always ties with the thing itself; the focused
one is the one with fewer sections and more doors behind it.

### 3. The proof — `writeLesson`

Every step is performed in a real browser before it is written down. A step that cannot
be performed — the control is gone, the press changes nothing, it leaves the product, it
leaves the screen the lesson is about — is **dropped with its reason**, and the reasons
are in the tour's own file. A tutorial that instructs a viewer to press something that
does nothing is worse than no tutorial.

One substitution is allowed, and only one. A product does not hold still between the
reading and the shoot: measured on panoma, the catalogue lost a project in the hour
between them and the tile the route named had moved, so every step was dropped and the
lesson was correct and useless. A step that names a row is not really about that row — it
is about opening *a* project — so a name that matches nothing is matched by **shape**
(same first word, same last word, same number of words) and only when at least three
controls share it, which is the same three-of-a-kind that makes a collection in the
reading. Below three it is not a list, it is a coincidence, and pressing a coincidence is
how a tutorial points confidently at the wrong thing. The substitution is written into the
tour's record beside the step, never silently.

What comes out is a `TourScript`, the same shape the walker writes, so `panoma-video record`, the
planner, the studio, the renderer and the review gate need to know nothing about lessons.

The camera budgets each step from the content it actually revealed. A short toggle
result gets less reading time than a panel of instructions; a heading budgets its own
visible section. The resulting pause is bounded between 2.6 and 4.8 seconds and begins
after the recorder has observed the visible result settle. This replaces the same
3.2-second wait on every lesson step and the 1/1.5-second waits on tours later turned
into tutorials. The check is shared by both paths and runs again on every take, so a
slower mobile transition gets its own time. Nothing is slowed below the conform rate
or animated to disguise a still page. Narration that exceeds the available footage
can still produce a reported hold; the capture budget is not a promise that every
sentence will fit. [tour.md](tour.md) records the observation limits.

## What it will not press, and where it is checked

This drives somebody's running product, against their data, and a press cannot be taken
back by deciding afterwards that the film was wrong. So:

- The **destructive** and **external** lexicons are refused in the executor, not only in
  the prompt — a rule enforced only in a prompt is a request. Three times, in fact: on the
  answer (`routerFor`), on the route step, and again on the control the page actually
  resolved to — which is a different string whenever a row has been substituted, and
  checking the plan while pressing something else is the shape of every guard that turns
  out not to have been one.
- **A press must be a control the reading saw.** The route is partly written by a model
  that has read the product's own copy, and a product's own copy is where an injected
  instruction would live. The reading is the only list of controls that existed before that
  copy was read, so a name that is on the page now and was not in the reading is refused.
- The lexicons carry Spanish, French, German and Portuguese as well as English, and words
  that are also ordinary nouns ("block", "report", "order", "run") count only when they
  OPEN a control's name, because interface labels are verb-first — "Block user" is an
  action and "Regenerate the block" is not. A Japanese or Arabic interface is defended by
  the brain's own refusals and by nothing in the lexicon; that is a real limit.
- The brain is told the rule in the same words: never press anything that sends, pays,
  deletes, publishes, logs out, installs, rewrites a file, starts a build, or spends
  model credits, and when in doubt, `show`.
- **Without a brain, nothing speculative is pressed at all.** Words cannot tell a safe
  press from an expensive one: on panoma the controls that teach the subject best are
  called "Fix the obvious" and "Ask the model's opinion" — the first rewrites a file in
  somebody's repository, the second spends their model credits, and neither shares a word
  with the request that would have ranked it. The wordless route reads the screen instead.

On the first real lesson, asked for panoma's `.md` panel, the brain wrote this into the
record on its own:

> "It deliberately stops there without pressing the sync, fix, or model-opinion controls
> on that screen, since those change or spend on the file rather than teach how it is
> viewed."

## Where the words come from

Not from here. The route carries a plain-English reason per step for the record, and
nothing else: the sentences are written by the existing path — the templates, then the
brain's `write` question — so every claim goes through the same fact audit as any other
piece. The one thing that travels is the request itself, which reaches `writeQuestion`
as `about`: the hook becomes the promise it makes, and each step becomes one part of the
answer. Without that, a tutorial's sentences describe what the camera happened to do,
which is a tour with narration over it.

## Limits

- The reading is bounded (14 screens by default) and says which addresses it did not
  open. A route planned on a partial map can be a lesson about the wrong screen; the
  unread list is in the report for exactly that reason.
- The wordless route is only as good as the vocabulary the request and the interface
  share. A request in Spanish about an English interface shares almost none, and the
  route then falls back to structure — which reaches the right area far less often than
  a brain does.
- A lesson is one flow. A request that is really three questions produces the first one.
