# panoma video as an optional app

panoma video remains an independent program. Panoma installs the official `@panoma/video`
package, runs one MCP child per job, and owns the web interface, queue, permissions and
budgets. The app owns its scenes, recordings, revisions, review and exports. There is no
second HTTP studio and no database connection in the child. A separate process is not an
operating-system sandbox.

## The package and handshake

The package starts at version `0.2.0`. Its `package.json` declares the app under `panoma.app`:
`panoma-video`, protocol `1`, and MCP entry `dist/mcp.js`. Package semver and the host
protocol are different clocks. `panoma_video_guide.version`, `SERVER_VERSION` and the
manifest's protocol agree. The host refuses incompatible protocols before running work.

`panoma_video_guide.requirements` and `panoma-video doctor --json` report the same local probe:
the expected Chromium executable, approximate download size, ffmpeg/ffprobe availability
(minimum major version six), selected H.264/AAC encoders, and resolved video home. The probe
makes no provider request and creates no workspace.

It answers at two depths, and the caller chooses. `probe: "deep"` launches and closes a blank
headless browser with a bounded timeout, so a missing system library reports unready like a
missing binary, and it reports the browser's version; `doctor` is always deep. The default is
cheap: the executable's presence on disk, and no version claimed for a browser that was never
started. That is what the host asks in the handshake it makes before every job, because a launch
costs a second of each one; it asks deep when a person presses «check requirements» and after a
download. Either answer is cached for a minute.

Installing the package does not install its browser; Playwright's explicit browser download is
a separate host action. ffmpeg is never downloaded or bundled. The manifest links its terms
and the packaged notices and [codec decisions](codecs.md). The size the manifest discloses and
the one the probe reports are one constant, held together by `manifest.test.ts`. The packaged
render test checks the complete renderer and encoder.

## Build and local verification

Development still runs source TypeScript. `pnpm build` compiles all workspace code and JSX
with tsup into ESM, including dynamically imported recipes. The production bundle replaces
the development JSX hook with an empty module. TypeScript, historical campaign briefs,
sessions, renders, fixtures and development keys do not travel in the tarball. Bundled fonts
carry their existing OFL licenses and `CREDITS.json`. Playwright, React, the MCP SDK and their
registry dependencies stay external and are pinned by `npm-shrinkwrap.json`.

Run `pnpm release:prepare` to build and create that production lock and third-party notices
in a temporary clean directory. `npm pack` verifies these outputs before packing. It never
publishes. `PANOMA_VIDEO_PACKAGE_TEST=1 node --test tests/package.test.ts` packs only the
allowlisted release files in a clean directory, installs with lifecycle scripts disabled,
proves the browser is initially absent, explicitly downloads it, then renders and reviews a
real facts video with the installed CLI. Set `PANOMA_APPS_SCHEMA` to the compiled
`@panoma/apps` module to validate the installed manifest with the host's schema as well.
`PANOMA_VIDEO_KEEP_PACKAGE` optionally retains the successfully tested tarball for host e2e.

### The mirror, which is not optional

What npm installs is compiled output. AGPL-3.0-only permits conveying object code only when
the recipient can reach the Corresponding Source, so `NOTICE.md` names a public mirror and a
tag, and a published tarball whose tag is not there is a breach of this project's own licence.

`node scripts/mirror.mjs` copies the tracked files at HEAD into the `video` directory of
<https://github.com/PanomaAI/apps>, writes the root README and licence, and tags
`panoma-video-<version>`. It refuses a tree with uncommitted changes, for the same reason the
pack refuses one. It prepares and reports by default; `--push` publishes. Run it before
`npm publish`, not after: a recipient arriving a second later has to find the tag.

The release workflow prepares and tests artifacts; publishing and trusted-publisher setup
remain owner operations. Publishing itself is one command and the account holder types it,
because the account requires a second factor on every write.

## Storage and identity

The host supplies absolute `PANOMA_VIDEO_HOME` and `PLAYWRIGHT_BROWSERS_PATH`. Installation
versions and browser binaries can be removed independently of video productions.
`videoHome()` continues to honor `~/.vira` when it is the only existing default. The app does
not automatically move or delete either home; adoption belongs to the host.

Every project MCP tool accepts optional `workspace_id`, the stable `project_id` first
returned by scout. A host maps that id to its own project identity and supplies it again
when the checkout moves. Calls without an override retain the standalone scout naming
behavior. Opening a saved story uses the supplied current project path without rewriting
its original captured identity. New captures remain an explicit new-story operation when
saved revisions exist. The caller remains responsible for mapping an authorized project to
its workspace; the MCP transport is a local trusted operator interface.

## Progress, cancellation and spending

A request with `_meta.progressToken` receives `notifications/progress`. Every change of stage
is delivered; repeated updates within a stage are coalesced and the final pending update is
flushed before the result. Counters increase monotonically. Stage messages use
`<stage>: <summary>` in English. With no token there are no notifications. The SDK request's
`signal` reaches the pipeline, renderer and revision adapter. Under `PANOMA_APP_JOB`, the temporary product server stays in the MCP guardian's process
group; standalone operation retains its own group. The host also owns terminating
an unresponsive process tree. Cached stages support retries; no resumable frame queue is
promised. When an encoded saved revision fails review, the MCP result remains an error
and retains its MP4, review report, plan, kit and provenance paths for inspection.

Panoma defaults to `PANOMA_VIDEO_BRAIN=none` and passes `voice: "none"`. It supplies only the
credentials explicitly enabled for that app and job. No CLI startup loads `.env`; development
can use Node's explicit `--env-file=.env`. The standalone brain selection retains its existing
default unless an environment setting or argument overrides it.

`PANOMA_APP_JOB` identifies one host job. `PANOMA_VIDEO_MAX_BRAIN_CALLS` is its reserved provider
call allowance, and it is the only spelling: one number answered to two names, which is two
contracts. Only integers from zero through one thousand are accepted. The allowance covers actual model and
ElevenLabs provider attempts, including schema retries and multiple brain instances during
a fix pass. A voice-only job uses the same reservation. Every attempt is
recorded before dispatch, so a failed request still counts. Structured MCP results include
`spend: { calls, provider, model?, usage? }` for host jobs. A redacted, prompt-free
`panoma-app-spend` line on stderr preserves the count if the transport fails. The host books
this against its reservation; no price is invented. Provider usage is included only when
reported. Voice character limits are separate and are not a monetary ceiling.

Text models may receive the README, sourced facts and bounded screen text. ElevenLabs
receives narration sentences. A CLI model on the same computer still talks to its provider;
local rendering does not make provider calls local. Rendering and explicit scene edits work
without a text model; natural-language revisions require one.
