# Create, revise, review and export a video

A project workspace connects to a complete creation workflow, with scene revisions
available for ProductPromo. The CLI and MCP consume the same saved story and
composition matrix; an edit is never a separate draft held somewhere else.

## The browser studio, and why it is gone

Until 2026-09-07 this workflow also had a browser surface — the `preview` verb, a local
HTTP server with its own page for choosing a project, filling in a creation form,
scrubbing compositions and queueing exports. It was removed whole. panoma video is becoming a
feature of panoma, which already has exactly one web surface, and a second one would
have to be kept, styled, translated and defended for the rest of its life. Its
creation form was also the last non-English prose in this repository.

What went with it: the preview server and its page, the durable job store under
`PANOMA_VIDEO_HOME/studio/jobs`, and the `preview` verb. The revision journal, the review gate
and the export path were never browser code — they live in `studioWorkspace`
(`packages/director/src/studio.ts`) and are reached now the way agents already reached
them.

A second pass on 2026-09-07 removed the chain the browser left behind and nothing else
called: `studioProjects` (the project picker's listing), `createStudioVideo` (the
creation form's whole run), `creationCapabilities` (a capability table for a form that
no longer exists) and `validateCreationRequest` (the form's request validator). Two
things inside the validator were doing real work and were kept by moving them, not by
deleting them:

- **The output directory can never be inside the project being filmed.** The header of
  `packages/director/src/workspace.ts` had promised that since it was written, and the
  validator was the only code that checked it — so `PANOMA_VIDEO_HOME=./out panoma-video auto .` wrote
  takes, voice files and renders into the repository being filmed. The check is now in
  `openWorkspace`, the one door every workspace comes through, and it runs before the
  first directory is created. It resolves symlinks, it asks about the project directory
  as well as the home, and it places a home that does not exist yet by its nearest
  existing ancestor rather than creating it to find out. It is a path-boundary test, so
  `…/app-out` beside `…/app` is a different directory and is allowed.
- **`--music=` has to name an audio file.** The validator refused a directory or a
  `.env`; the terminal never reached the validator and handed the argument to ffmpeg
  instead. The check is now in `scoreTrack` (`packages/director/src/music.ts`), which
  every brought track is scored through.

What this costs, stated plainly: there is no scrubber and no queue. An export is a
foreground command that finishes or fails; interrupting one leaves no resumable job.

## Create a production

`panoma-video auto <path>` plans and films a project, and `--goal=` selects what it makes;
`panoma-video promo`, `panoma-video tutorial` and `panoma-video teach` are the shorthands. Every run reserves a
workspace under `PANOMA_VIDEO_HOME`, preserving earlier stories, captures and exports.

Product presentations expose the editorial themes and the manual opening, reading pace
and recap controls. Normal remains the default; only an explicit automatic theme choice
lets the planner choose an expressive style. The selected theme applies to added
graphics, never the recorded application.

Product presentations, release announcements and tutorials are separate choices. A
release request cannot fall back to a promotion, nor a tutorial to fact cards.
Automatic selection takes one available recipe from the plans this product's material
earned, preferring a promotion, release, feature demonstration, site tour, tutorial and
finally sourced fact cards in that order. The saved selection names the recipe and
explains that choice. This bounded order is a product default, not a measured
prediction of engagement.

The tutorial task can be supplied in words or left for panoma video to choose. Narration is
currently supported for tutorials only, and requires the configured ElevenLabs provider;
without one the video communicates through type. Narration runs before the matrix is
built with its final timing, and a requested voice that fails or does not mount cannot
return a successful silent production. Interaction sounds remain available without
narration. An optional local music file goes through the measured/conformed track path;
a failed supplied track is reported, rather than silently replaced. Musical movement
stays off unless selected.

Audience, desired viewer response and creative directions guide a promotion's argument.
They are explicitly internal direction, not additional fact authority. Incompatible
options and unknown fields are refused by `CreationRequestSchema` when a saved
`creation.json` is read. A product with no supported recorded result receives its actual
missing-material reason.

`creation.json` records normalized settings, the chosen brief, recipe, languages,
formats and actual voice choice. The selected formats constrain compilation, audio
preparation and export, including after reopening and scene revisions. The camera still
records paired desktop/mobile material; format selection limits outputs, not the
exploration or capture budget. Other planned briefs remain evidence on disk but cannot
break or expand that production. An invalid saved selection fails closed. Creation
settings are the initial request; the scene revision journal remains the authority for
later presentation edits. This selection applies through `studioWorkspace`, including
`panoma-video render`; independently replanning a workspace through `panoma-video auto` is a separate
advanced workflow and is not a configuration editor.

## The story

`panoma-video story` shows each opening and demonstration, its observed context and source
facts. `panoma-video revise` changes text per language, opening, reading pace, theme, recap,
presentation or proof order. Reordering is staged with text edits so a new leading
demonstration and its opening can be validated together. Save changes to create a
version, or describe an adjustment to the configured brain. Structured edits work
without a brain; natural-language instructions require one and never silently fall back
to unrelated changes.

Every revision preserves untouched fields exactly. Source panels and the product's
identity stay verbatim. The complete edited brief passes the claim and proof menu
checks, and every hook/language/format is compiled and checked before saving. A missing
mobile recording cannot pass by substituting the desktop take.

A render pins its story and asset fingerprint; edits made elsewhere cannot label old
pixels as a new version. The source manifest travels with each export, including its
recorded take, mounted audio and disclosure metadata.

## Versions and recovery

The journal lives at `<workspace>/promo-revisions/<brief>.json`, outside the filmed
project. A write is atomic and requires the revision the caller read. Concurrent edits,
replaced captures, changed facts and external plan changes produce an explicit conflict.
Restoring an earlier version appends a new version instead of erasing history. An
explicit new story archives the previous journal before adopting its validated new
baseline; archived files and exported versions remain.

## One finishing path

`reviewComposition` combines encoded-file checks and the same story checks used by the
automatic path. ProductPromo also samples its actual Chromium layout at settled reading
frames: titles, source examples, split copy, the complete recap and close. Overflow,
collapsed text and text outside the safe Stage identify their scene, frame and fixer.
The deliberately cropped recorded window is exempt from DOM text inspection; editorial
text beside it is not.

These are measured layout and technical checks, not an audience or sales score. The
editorial assessment exposes narrow reasons such as generic copy, repeated proof, or a
setup screen chosen ahead of a completed result. A person still judges the persuasive
argument and the finished film.

The story's `originalArgument` names the situation, desired outcome, leading proof and
limits chosen when the promotion was generated. Its `argumentScope` is `original-plan`:
later copy or proof revisions do not silently turn that earlier model hypothesis into a
fresh assessment of the changed film.

Rechecking a versioned export uses its original story and timing, with the encoded file
and its material verified against their saved identities. It never borrows the current
story's result or replaces a complete review with technical checks alone. Previously
measured layout remains identified as evidence from that export.

Workspace ProductPromo exports from `panoma-video render`, `panoma-video launch` and `panoma_video_render` use
the saved effective revision. `panoma-video auto` retains a revised story when its recorded
sources still match. A new creative direction for that story is an explicit revision or
a new-story request, never an incidental replan at export.

## Agent and CLI controls

```bash
panoma-video story <brief> --project=<workspace-id>
panoma-video revise <brief> --project=<workspace-id> --revision=<revision> --instruction="Show the result first; keep the wording."
panoma-video revise <brief> --project=<workspace-id> --revision=<revision> --edits=/path/to/edits.json
panoma-video revise <brief> --project=<workspace-id> --revision=<revision> --restore=<older-revision>
```

MCP provides `panoma_video_story` and `panoma_video_revise` with the same validated document and
request. The immutable identifier returned by `panoma_video_render` resolves through
`panoma_video_review` and `panoma_video_frame`. Agent-facing story reads do not synthesize audio.

The tests exercise real filesystem revisions, every theme in both promo formats, and a
real encoded MCP revision followed by review and frame extraction. A separate audit of
five existing products reported usable material and explicit gaps; it did not claim
five publishable promotions.
