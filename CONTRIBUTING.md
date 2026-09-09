# Contributing to the panoma apps

Thank you for taking a look. This repository holds the source of the official apps for
[panoma](https://github.com/PanomaAI/panoma), one directory per app. Today that is one:

| App | Directory | Package |
| --- | --- | --- |
| panoma video | [`video/`](video) | [`@panoma/video`](https://www.npmjs.com/package/@panoma/video) |

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Disagreements
about code are resolved with evidence and arguments; respect for the person behind it is
not negotiable.

## How this repository is published

This is a publication mirror. Each app is developed in a working repository and published
here, whole, with every release: the tag `panoma-video-<version>` is the exact source of
the `@panoma/video` package with that version on npm, which is what the AGPL requires of
compiled output. Pull requests are reviewed here. A merged change is applied to the working
repository and ships in the next release published here, with your authorship kept on the
commit — so a merged pull request may take one release to reappear in `main`, and that is
expected rather than lost.

## Before writing code

Search [issues](https://github.com/PanomaAI/apps/issues?q=is%3Aissue) and
[pull requests](https://github.com/PanomaAI/apps/pulls?q=is%3Apr) first, including closed
ones. For substantial work, leave a comment on the issue before starting so two people do
not build the same change.

| What you are bringing | Where to start | What we need |
| --- | --- | --- |
| A bug | [Bug report](https://github.com/PanomaAI/apps/issues/new?template=bug_report.yml) | Expected and actual behaviour, exact reproduction steps, the app's version, and the operating system. For panoma video, the output of `panoma-video doctor --json` saves half a conversation. |
| A feature or architecture change | [Feature proposal](https://github.com/PanomaAI/apps/issues/new?template=feature_request.yml), before writing code | The problem, how you solve it today, and why it belongs in this app. |
| An unambiguous documentation correction | A direct pull request may be enough | Which statement was wrong and how you verified the replacement. |
| A possible security vulnerability | [Private report](SECURITY.md), never a public issue | Impact, version, operating system, and a minimal reproduction without publishing secrets or private paths. |

Each app has a deliberately narrow purpose. panoma video makes videos about software from
the software itself; saying no to good ideas outside that purpose is part of maintaining it.
Half an hour of discussion is better than an afternoon spent on a change that cannot merge.

## Find the right part

Every app carries its own `AGENTS.md`, and it is the map: read it before changing a line.
For panoma video, [`video/AGENTS.md`](video/AGENTS.md) has the layout, the set-up, the rules
that tests enforce, and a section of traps that have already been paid for once — read that
one before treating something unusual as a bug. The decision records are in
[`video/docs/`](video/docs).

## Set up panoma video

You need Node.js 22.18 or newer, pnpm, and `ffmpeg` with `ffprobe` on `PATH`. From `video/`:

```bash
pnpm install
pnpm --filter "./packages/capture" exec playwright install chromium
pnpm test
```

The second line is a separate step and nothing runs it for you: `playwright` declares no
install script, so `pnpm install` never fetches a browser, and the line above downloads
roughly 550 MB of Chromium. Every frame the renderer draws goes through that browser.

Provider keys are supplied explicitly in the environment. Development may use Node's
`--env-file=.env`; an installed app never reads a `.env` on its own. With no key set, the
brain is `none` and the voice is off, and the whole suite runs that way.

## Verify the change

Before opening a pull request, from `video/`:

```bash
pnpm -r typecheck && pnpm exec tsc -p tsconfig.tests.json
pnpm test
```

If you touched packaging, the release scripts, or a dependency, also run the release gate:
`PANOMA_VIDEO_PACKAGE_TEST=1 node --test tests/package.test.ts`. It packs the release files
in a clean directory, installs with scripts disabled, downloads the browser, drives the MCP
handshake, and renders and reviews a real cut. It takes several minutes and it is the only
check that exercises what a person actually installs.

Say in the pull request which operating system you tested on. CI runs Linux on every push
and Windows weekly; macOS only when asked. The matrix does not replace saying what you
verified yourself.

## How we write here

- **English is the canonical language for repository prose.** Identifiers, filenames,
  comments, documentation, and commit messages use English.
- **Comments explain why, not what.** A comment that records a decision is useful; one that
  narrates the next line is noise. If you fix something subtle, record the failure that made
  the code necessary.
- **Promises get tests.** If a change claims something — a cut lands on a beat, a path
  outside the project is refused — include a test that fails when the claim stops being true.
  Tests are `node:test` files under `tests/`, and several read source files as text on
  purpose, to guard an order or an absence that cannot be executed.
- **There is no formatter.** Do not submit a reformatted file. Two spaces, double quotes,
  semicolons; `.editorconfig` carries them.
- **Commit messages describe the effect, not the file.** Prefer "A light product filmed on
  a dark stage, because the theme was one value and not two" over "Fix theme.ts".
- **Nothing non-free enters the tree.** `tests/licenses.test.ts` reads every installed
  package and fails on a licence outside its allowlist. Code ported by hand is attributed in
  a source comment *and* in `THIRD-PARTY-NOTICES.md`, because the compiler strips comments.

## Prepare the pull request

Open the pull request against `main` and treat its description as the durable record of the
change, not a handoff note. It should answer:

- **What problem does this solve, and why does it belong in this app?** Link the issue with
  `Closes #...` when appropriate.
- **What behaviour changed?** Describe the observable effect rather than listing files.
- **How was it verified?** Exact commands, the manual path, the operating system, and
  anything you could not verify.
- **What protects it going forward?** Point to the test that would fail if the promise broke.

For a visual change, attach the rendered frame or contact sheet before and after. One pull
request does one thing. If you find another problem while working, record it in a separate
issue or explain why it is inseparable; do not fix it opportunistically.

## Contributor License Agreement (CLA)

Before your first contribution can merge, you must sign the
[Contributor License Agreement](CLA.md). It takes about five minutes to read, is signed once,
and covers both past and future contributions.

**You keep your copyright.** This is a licence, not an assignment. You remain free to use,
publish, and relicense your own work.

**Why the project needs it:** the agreement allows the project to sell exceptions to the
AGPL and build paid products that reuse project code — the same two permissions stated in
its section 2. Some organisations cannot use AGPL software under their internal policies. A
commercial licence for the same code and new paid products built on top are how the project
can be funded without closing it. That requires permission from everyone who contributed.

**What binds us in return:** section 4 requires every contribution to remain available under
the project's free licence. If that obligation were broken and not cured, the agreement lets
you withdraw the licence going forward. Anything the public already received under the AGPL
remains irrevocable, deliberately preserving the legal basis for a fork.

**This structure is established rather than invented here:** it follows Element's CLA for
Synapse and Canonical's long-standing Ubuntu agreement — the Apache ICLA combined with the
Harmony project's outbound-licence commitment known as "Option Five".

To sign, open your pull request and post this exact comment:

```
I have read the CLA Document and I hereby sign the CLA
```

Signatures are stored in [`.github/cla-signers.json`](.github/cla-signers.json), visibly in
this repository. No external service stores them or receives access to the repository.

### If your employer owns the code

You cannot truthfully sign the individual agreement if your employer owns the work. Use the
[Corporate Contributor License Agreement](CCLA.md) instead. It must be signed by someone who
can bind the company and includes a list of authorised contributors in Schedule A. Their pull
requests no longer require individual signatures; the automated check recognises them.

Email `support@panoma.ai` from a company address before opening the pull request.

## Licence

By contributing, you agree that your work is published under the
[AGPL-3.0](LICENSE), like the rest of the project. The names *panoma* and *panoma video*
are not part of that grant; [TRADEMARK.md](TRADEMARK.md) says what you may do with them.
