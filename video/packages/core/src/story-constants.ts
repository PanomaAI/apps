/*
  The one number of the trailer grammar that the story layer needs without pulling
  the render app into core: a claim card carries at most five words. Measured on
  Linear's and Cursor's announcement videos ("Monitor key metrics", "Review changes in
  a single place"); the full beat sheet lives in apps/render/src/recipes/timing.ts.
*/
export const TRAILER_CLAIM_MAX_WORDS = 5;
