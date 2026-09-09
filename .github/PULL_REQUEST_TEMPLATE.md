## What changes

<!-- One sentence: what does this change make possible or correct? -->

## Why

<!-- Describe the problem rather than the implementation. Link the issue with "Closes #12". -->

## Evidence

<!--
  Tell a reviewer how to verify the change: exact commands, the manual path, the test that
  fails when the change is reverted, and the operating system you used. For a visual change,
  attach the rendered frame or contact sheet before and after.
-->

## Before requesting review

- [ ] `pnpm -r typecheck && pnpm exec tsc -p tsconfig.tests.json` passes in the app's directory
- [ ] `pnpm test` passes there
- [ ] Every promise introduced by this change has a test that fails when it stops being true
- [ ] Nothing in the diff is a key, a `.env`, or a path on my own machine
- [ ] New identifiers and repository prose are in English
- [ ] I signed the [CLA](../blob/HEAD/CLA.md), or I will sign it in this pull request with the required comment
