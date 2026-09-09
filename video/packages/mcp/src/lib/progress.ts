/*
  Progress for the slow tools, at the rate the protocol and the client both want.

  A render takes 30 to 180 seconds. Claude Code moves a call to the background after
  two minutes on its own and aborts one that stays silent for thirty, so a slow tool
  has one job: keep talking. The spec wants `progress` to increase every time and
  both sides to rate-limit, so this emits at most once a second, always monotonic,
  and always with a sentence a person could read in the client's status line
  (modelcontextprotocol.io/specification/2026-07-28/basic/utilities/progress).

  When the client sent no progressToken this is a no-op, which is what makes every
  tool safe to call from a client that never asked.
*/

export type ProgressParams = { progressToken: string | number; progress: number; total?: number; message?: string };

/** The slice of the SDK's request context this module reads; the SDK's own type satisfies it. */
export type Extra = {
  _meta?: { progressToken?: string | number };
  sendNotification?: (n: { method: "notifications/progress"; params: ProgressParams }) => Promise<void>;
  signal?: AbortSignal;
};

export type Progress = {
  (done: number, total: number | undefined, message: string): void;
  /** Settle the last message before the result goes back. */
  finish(message?: string): Promise<void>;
  readonly signal: AbortSignal | undefined;
};

export function progressFor(extra: Extra, minIntervalMs = 1000): Progress {
  const token = extra._meta?.progressToken;
  const send = extra.sendNotification;
  let last = 0;
  let highest = 0;
  let lastStage = "";
  let latest: { done: number; total: number | undefined; message: string } | undefined;
  let pending: Promise<void> = Promise.resolve();

  const emit = (progress: number, total: number | undefined, message: string) => {
    if (token === undefined || !send) return;
    const params: ProgressParams = { progressToken: token, progress, ...(total !== undefined ? { total } : {}), message };
    pending = pending.then(() => send({ method: "notifications/progress", params })).catch(() => undefined);
  };

  const report = ((done: number, total: number | undefined, message: string) => {
    const now = Date.now();
    const stage = message.split(":", 1)[0];
    latest = { done, total, message };
    if (stage === lastStage && now - last < minIntervalMs && done !== total) return;
    last = now;
    lastStage = stage;
    highest = Math.max(highest + 1, done);
    emit(highest, total === undefined ? undefined : Math.max(highest, total), message);
    latest = undefined;
  }) as Progress;

  Object.defineProperty(report, "signal", { value: extra.signal, enumerable: true });
  report.finish = async (message?: string) => {
    if (message) emit(++highest, undefined, message);
    else if (latest) emit(++highest, latest.total === undefined ? undefined : Math.max(highest, latest.total), latest.message);
    latest = undefined;
    await pending;
  };
  return report;
}

/** Throw the moment a client cancels, so a render does not keep painting into the void. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Cancelled by the client.");
}
