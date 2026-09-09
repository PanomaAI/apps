/* One child serves one host job. Count model and voice provider attempts, including schema retries. */
export type AppSpend = { calls: number; provider: string; model?: string; usage?: { input: number; output: number } };
const jobs = new Map<string, AppSpend>();
export function appCallCap(env: NodeJS.ProcessEnv = process.env): number {
  // One name for one number. The host sets this one; two spellings were two contracts.
  const value = Number(env.PANOMA_VIDEO_MAX_BRAIN_CALLS ?? 24);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000) throw new Error("The provider call allowance must be an integer from zero to one thousand.");
  return value;
}
export function appSpend(): AppSpend {
  const row = jobs.get(process.env.PANOMA_APP_JOB ?? "");
  return row ? { ...row, ...(row.usage ? { usage: { ...row.usage } } : {}) } : { calls: 0, provider: "none" };
}
export function reserveAppCall(provider: string, model: string): void {
  const job = process.env.PANOMA_APP_JOB;
  if (!job) return;
  const row = jobs.get(job) ?? { calls: 0, provider, model };
  if (row.calls >= appCallCap()) throw new Error(`The host's provider call allowance is exhausted. Calls: ${row.calls}`);
  row.calls++;
  row.provider = row.provider === provider ? provider : "multiple";
  row.model = model;
  jobs.set(job, row);
  // The last line survives a transport failure; no prompt or secret enters the log.
  console.error(JSON.stringify({ event: "panoma-app-spend", job, spend: row }));
}
export function recordAppUsage(usage?: { input?: number; output?: number }): void {
  const row = jobs.get(process.env.PANOMA_APP_JOB ?? "");
  if (!row || !usage) return;
  row.usage ??= { input: 0, output: 0 };
  row.usage.input += usage.input ?? 0;
  row.usage.output += usage.output ?? 0;
}
