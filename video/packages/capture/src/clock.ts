/** The measured mapping already applied to every time in a recorded session. */
export type VideoClock = {
  source: "screencast";
  version: 1;
  /** Presentation timestamp of the first encoded frame, in Unix milliseconds. */
  originMs: number;
  /** Added to the pass's elapsed timestamps once, before the session is saved. */
  offsetMs: number;
};

export function isCalibratedVideoClock(value: unknown): value is VideoClock {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const clock = value as Partial<VideoClock>;
  return clock.source === "screencast" && clock.version === 1 &&
    typeof clock.originMs === "number" && Number.isFinite(clock.originMs) && clock.originMs > 0 &&
    typeof clock.offsetMs === "number" && Number.isFinite(clock.offsetMs);
}

/**
 * Playwright's encoder and public onFrame callback receive the same presentation
 * timestamp. Its first frame is video zero; callback arrival and page creation are
 * different clocks. Keep recording work out of the callback: only the origin is read.
 */
export function createVideoClock(passStartedMs: number) {
  if (!Number.isFinite(passStartedMs) || passStartedMs <= 0) throw new Error("Invalid recording clock start.");
  let originMs: number | undefined;
  let failure: Error | undefined;
  let signal: () => void;
  const observed = new Promise<void>(resolve => { signal = resolve; });

  function metadata(): VideoClock {
    if (failure) throw failure;
    if (originMs === undefined) throw new Error("No browser frame timestamp; the recording clock is uncalibrated.");
    return { source: "screencast", version: 1, originMs, offsetMs: passStartedMs - originMs };
  }

  return {
    observeFrame(timestamp: number): void {
      if (!Number.isFinite(timestamp) || timestamp <= 0) {
        failure = new Error("Invalid browser frame timestamp; the recording clock cannot be calibrated.");
        signal();
        return;
      }
      if (originMs === undefined) {
        originMs = timestamp;
        signal();
      }
    },
    async ready(timeoutMs = 4000): Promise<void> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([observed, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
        if (originMs === undefined && !failure) throw new Error(`No browser frame timestamp within ${timeoutMs}ms; the recording clock cannot be calibrated.`);
        metadata();
      } finally { clearTimeout(timer); }
    },
    /** Durations are intervals and must not pass through this origin conversion. */
    time(elapsedMs: number): number {
      return Math.round(Math.max(0, elapsedMs + metadata().offsetMs) * 1000) / 1000;
    },
    metadata,
  };
}
