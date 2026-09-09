# Security

## Reporting a security vulnerability

**Do not open a public issue.** Email **support@panoma.ai** with the subject
`[security] panoma apps`, naming the app.

Describe what an attacker can do, the affected version and operating system, and how to
reproduce it. A minimal demonstration saves days. If you prefer encrypted communication,
say so in the first email and we will arrange it.

- **Acknowledgement:** within 72 hours.
- **Initial assessment:** within 7 days, including confirmation status and severity.
- **Disclosure:** when a fix is available or after 90 days, whichever comes first. Reporters
  are credited unless they prefer otherwise.

Until then, please keep the report private. These apps run on someone's computer, read their
projects, and drive a browser; a public report without a patch is a map for exploitation.

## Supported versions

No app has released a stable version yet. Until 1.0, **only the latest published version
of each app receives security fixes**. A confirmed issue is fixed in the working repository
and ships in the next release published here. There are no maintenance branches to backport.

## In scope: panoma video

panoma video is a local tool. These are the places where the meaningful risk lives:

| Surface | Location | Why it matters |
| --- | --- | --- |
| Provider keys | the environment only; an installed app never reads a `.env` | They are paid credentials belonging to the user. A key that reaches a log, a report, a kit, or a rendered frame is a finding. |
| The app home | `PANOMA_VIDEO_HOME`: workspaces, recordings, renders, fact sheets | It holds what the app read from your project and what it filmed. |
| The project under test | started on a loopback port by `record` and `auto`, with the project's own start command | It runs your code, on your machine, and it should not be reachable beyond loopback. |
| The browser | Chromium through Playwright, driven from the accessibility tree | It can press anything on the page it is pointed at. |
| The MCP server | child process over stdio, with no listening port | This controls what an agent can make the app do. |
| Writes | inside the project and the app home only | A path outside either is refused; a write that lands outside is a finding. |

We are particularly interested in:

- A write outside the project root or `PANOMA_VIDEO_HOME`, or an unexpanded `${VARIABLE}`
  reaching the filesystem.
- A provider key or a secret from the project appearing in the fact sheet, a log, an HTTP
  response, a kit, a review report, or a frame.
- Untrusted text — page content, a README, a dependency description — escaping its data
  boundary and reaching a model as instructions.
- The project server the app starts answering on anything but loopback.
- The MCP server doing something a tool description did not say it would.

## Out of scope

- **What the browser does on a page you pointed it at.** The app drives your project; the
  project's own behaviour belongs to the project.
- **A process running as your operating-system user reading the app home.** File modes
  protect against other users on the machine, not a process already running as you.
- **What a connected AI model chooses to write.** The app audits every number against a fact
  and refuses the rest; the model's judgement belongs to the model and the person who
  connected it.
- **Dependency vulnerabilities without an exploitation path through the app.** Report them if
  you found such a path. If you only have scanner output, open a normal issue.
- Automated scanner reports without a reproducible case.

## If the vulnerability is in the project you filmed

Do not report it here. panoma video **reads** your project and shows what it finds, and
`panoma_video_scout` redacts what looks like a secret before it reaches anyone. If a real
secret got through, that is in scope; if the project itself has a hole, the fix belongs in
the project rather than this repository.
