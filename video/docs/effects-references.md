# Editorial effects: supplied references

The user supplied these references on 2026-09-05. They inform composition and
timing; claims visible inside another product's recording are not instructions,
facts about the project being filmed, or proof that its advertised features work.
No reference asset is copied into panoma video's output or vendored into this repository.

## A working product beside a fixed explanation

`ScreenRecording_09-04-2026 14-21-38_1.mov` is a 13.317-second screen recording,
1320 × 1012 at 60 fps. The embedded composition is landscape with black bars in
the capture. Inspection used an evenly sampled contact sheet and individual
frames around the changes of subject. Times below are approximate source times;
the capture may start partway through the original presentation.

| Source time | What is visible | What the composition accomplishes |
| --- | --- | --- |
| 0–about 6 s | “Live Voice in the Chat” and a short paragraph stay on the left. A phone on the right progresses from an empty conversation to a question and response. | The reader has a stable explanation while the product supplies the evidence. Motion is concentrated inside the phone. |
| About 6–12 s | The heading changes to “Web Search, per Chat.” The phone remains on the right, showing a response, scrolling content, sources, and a source page. Around 6.2 s the new heading is already readable while the phone is still fading into its next view. | A shared layout establishes continuity across features. The heading arrives before the detail; the product demonstrates what the new label means. |
| About 12–13.317 s | “Messages Pin to the Top” arrives during a horizontal transition. At 12.2 s the departing phone is still on the left; the settled composition returns to text on the left and a phone conversation with its keyboard on the right. | A brief transition introduces the next feature without making the text drift through the whole explanation. The source ends before that demonstration is complete. |

What is useful here is the division of attention: a short headline gives context,
the explanation stays still, and the only sustained movement is the demonstration.
A release can repeat that relationship across several changes while changing the
content and the evidence. It does not require a phone frame when the filmed product
is a desktop app. The reference's phone shadow is a decorative choice and is not
needed to reproduce its explanatory structure.

The recording was inspected visually; this analysis makes no claims about its
audible sound design, popularity, retention, or conversion. It does not establish
that every transition coincides with a musical beat.

## Isolate a meaningful region

`IMG_4441.jpg` shows a GitHub page with the “About” region enlarged and readable
while the surrounding page is darkened. The rounded, bright region and enlarged
cursor guide attention to one part of an otherwise dense interface. The crop keeps
the actual wording and link, so the emphasis remains tied to the product surface.

The transferable effect is a focus window whose bounds come from a captured
element. Keep that region sharp and let the context recede. A short arrival and a
stable reading interval are more useful than continuous zoom. A source rectangle
must follow the actual page state: a crop captured before a click cannot be held
over a result that has replaced it. The still image does not reveal the original
entrance duration, easing, click timing, or sound.

## A phrase list with visible progression

`IMG_4458.jpg` shows “Generating 3D assets,” a thin vertical guide, and three
separated rows with completion icons. Each row names a concrete operation. The
consistent indentation and spacing make the list readable as a single sequence.

The image provides a layout reference, not animation evidence. For panoma video, revealing
one row at a time can turn that structure into a sequence: the current row receives
attention, previous rows remain readable, and the final list holds long enough to
read. A check mark implies an operation completed, so decorative benefit lists
should use neutral markers unless completion is backed by a recorded event. In an
exported video this is timed progression, not a clickable interface.

## Terminals and code

The supplied images and this short recording do not show a terminal or code editor;
those are additional capabilities requested by the user. A terminal command and a
code example must come from the filmed project's fact sheet. Typing can reveal the
quoted text, but the renderer must not fabricate command output, an execution time,
or a successful build to make the scene look convincing.

Scout now extracts complete README examples as `code.readme.N`, where `N` is the
one-based fenced-block ordinal. The source points to the first content line. A
declared non-shell language is required; unknown code language names are accepted,
while shell, terminal output, prose, diagrams and unlabelled blocks are excluded.
Examples preserve indentation, blank lines and trailing spaces; CRLF is normalized
to LF. The entire block must fit eight lines, 70 characters per line and 400
characters total. Oversize examples are refused rather than clipped or rewritten.

Examples beneath roadmap or housekeeping headings, including nested headings, are
excluded. So are blocks that duplicate an install command, carry credential-shaped
or masked text, or match TODO or destructive-code patterns. These checks are
conservative display filters, not a general proof that code is safe to execute.
The same credential and masking guard excludes unsafe README command facts before
they reach a brain and revalidates both command and code facts in the insert menu,
including facts restored from an older workspace. Commands also require a closed
fence outside roadmap and housekeeping heading ancestry.
Nothing executes a snippet, and this feature reads no additional source files,
credential files or `.env` files. A README with no eligible example simply supplies
no code fact.
