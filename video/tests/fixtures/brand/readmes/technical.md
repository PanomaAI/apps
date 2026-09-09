# libconform

libconform implements deterministic conformance of variable-rate media timelines to integer frame grids, exposing a resampling-free retiming primitive whose asymptotic complexity is linear in the number of source keyframes and whose numerical behaviour is specified by the invariants enumerated in the specification section below.

## Installation

```sh
npm install libconform
pnpm add libconform
```

## Usage

```ts
import { conform, makeGrid } from "libconform";

const grid = makeGrid({ fps: 30, bpm: 120 });
const timeline = conform(source, grid, {
  minRate: 1.0,
  maxRush: 1.6,
  preserveActions: true,
});

for (const segment of timeline.segments) {
  console.log(segment.sourceStart, segment.sourceEnd, segment.rate);
}
```

## Invariants

The conformation operator guarantees monotonicity of the mapping between source timestamps and destination frames, boundedness of the instantaneous rate within the configured interval, and idempotence under repeated application with identical parameters, which collectively permit compositional reasoning about concatenated timelines without re-verification.

```ts
assert(timeline.segments.every((s) => s.rate >= 1.0 && s.rate <= 1.6));
assert(timeline.segments.every((s, i, all) => i === 0 || all[i - 1].sourceEnd <= s.sourceStart));
```
