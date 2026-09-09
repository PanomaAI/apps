import { appCallCap, reserveAppCall, recordAppUsage } from "./app-spend.ts";
/*
  The brain: one `ask` that turns a typed question into a validated answer, and the
  three guarantees around it that let an unattended pipeline call a model at all.

  - IT COSTS LITTLE TWICE. Every question is content-addressed on the driver, the
    model, the prompts and the schema (@panoma/video-core/cache): a re-run of an unchanged
    project sends nothing, and changing one fact costs the questions that read it.
  - IT CANNOT RUN AWAY. Uncached calls are counted against a cap fixed before the first
    one; past it the brain declines and the pipeline continues on its templates. The
    doctrine for anything that spends is a key and a cap, never a key alone.
  - IT NEVER ANSWERS IN A SHAPE NOBODY ASKED FOR. Every answer is parsed against the
    question's zod shape; an answer that does not fit is sent back once with the
    validation error, and refused after that. What the shape cannot check — a digit
    nobody vouched for, a fact id that does not exist — the director's audit refuses
    downstream, line by line, and the template keeps its sentence.

  Every call is written to a ledger, and to a log file when one is given, with the
  question, the driver, whether the cache answered, and how long it took: a decision
  a model made about someone's video is a decision a person can read back.
*/
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { cached } from "@panoma/video-core/cache";
import { DRIVER_NAMES, DriverAnswerInvalid, type Ask, type Driver, type DriverName, type Effort } from "./driver.ts";
import { claude } from "./drivers/claude.ts";
import { codex } from "./drivers/codex.ts";
import { anthropic } from "./drivers/anthropic.ts";
import { openai } from "./drivers/openai.ts";

/** What the operator may ask for: a driver by name, the first one available, or none at all. */
export type BrainChoice = DriverName | "auto" | "none";

export const BRAIN_CHOICES: readonly BrainChoice[] = ["auto", "none", ...DRIVER_NAMES];

/*
  Uncached calls one run may make. A project asks one thesis, one re-rank per page
  walked (a dozen at most), one write, one fix per failing cut, and one kit copy per
  hook and language on a final run; this is about twice that, and it is small enough
  that a loop nobody expected is a nuisance rather than a bill.
*/
export const BRAIN_CALL_CAP = 24;

/** How long one answer may take. The CLI agents think; two or three minutes is normal for a page of material. */
export const BRAIN_TIMEOUT_MS = 240_000;

export type Asked<T> = {
  /** "thesis", "rerank", "write", "fix", "kit" — the cache key and the log's name for it. */
  id: string;
  /** Bumped when a question's prompt or shape changes, so an older cached answer is never served to a newer question. */
  version: number;
  system: string;
  user: string;
  shape: z.ZodType<T>;
  timeoutMs?: number;
  effort?: Effort;
};

export type Answer<T> = { value: T; hit: boolean; ms: number; model: string };

export type LedgerEntry = { at: string; question: string; driver: DriverName; model: string; hit: boolean; ok: boolean; ms: number; note?: string };

export type Ledger = { driver: DriverName; model: string; cap: number; calls: number; cached: number; failed: number; ms: number; entries: LedgerEntry[] };

export class BrainDeclined extends Error {
  readonly reason: "cap" | "aborted";
  constructor(reason: "cap" | "aborted", message: string) {
    super(message);
    this.name = "BrainDeclined";
    this.reason = reason;
  }
}

export class BrainAnswerInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainAnswerInvalid";
  }
}

export type Brain = {
  readonly driver: DriverName;
  readonly model: string;
  /** How the driver was found, for a report: "claude -p (2.1.258)". */
  readonly how: string;
  ask<T>(question: Asked<T>): Promise<Answer<T>>;
  ledger(): Ledger;
};

export const DRIVERS: readonly Driver[] = [claude, codex, anthropic, openai];

export type Detected = { driver: Driver; model: string; how: string } | { driver: null; why: string };

/**
 * Which brain this machine has. An explicit choice is checked and nothing else is
 * tried; "auto" takes the first available in DRIVER_NAMES order — the agents on the
 * machine before the keys in the environment; "none" is a choice too.
 */
export async function detectBrain(choice: BrainChoice = "auto", opts: { env?: NodeJS.ProcessEnv; drivers?: readonly Driver[] } = {}): Promise<Detected> {
  const env = opts.env ?? process.env;
  const drivers = opts.drivers ?? DRIVERS;
  if (choice === "none") return { driver: null, why: "no brain was asked for" };
  const wanted = choice === "auto" ? drivers : drivers.filter((d) => d.name === choice);
  if (wanted.length === 0) return { driver: null, why: `no driver is called "${choice}"; the choices are ${BRAIN_CHOICES.join(", ")}` };
  const reasons: string[] = [];
  for (const driver of wanted) {
    const a = await driver.available(env);
    if (a.ok) return { driver, model: a.model, how: a.how };
    reasons.push(`${driver.name}: ${a.why}`);
  }
  return { driver: null, why: reasons.join("; ") };
}

export type OpenBrainOptions = {
  choice?: BrainChoice;
  /** Where answers are cached; the workspace's cache directory. */
  cacheDir: string;
  /** A JSON-lines file every call is appended to. */
  logFile?: string;
  /** Where a driver may write scratch files and run from; a temporary directory when absent. */
  scratchDir?: string;
  maxCalls?: number;
  timeoutMs?: number;
  /** Overrides the detected model. */
  model?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** For tests: the drivers to detect among, in order. */
  drivers?: readonly Driver[];
};

/** A brain, or null with the reason in `why` when none is wired. */
export async function openBrain(opts: OpenBrainOptions): Promise<{ brain: Brain | null; why: string }> {
  const env = opts.env ?? process.env;
  const choice = opts.choice ?? ((env.PANOMA_VIDEO_BRAIN as BrainChoice | undefined) || "auto");
  const found = await detectBrain(choice, { env, drivers: opts.drivers });
  if (!found.driver) return { brain: null, why: found.why };
  const { driver } = found;
  const model = opts.model ?? found.model;
  const cap = opts.maxCalls ?? appCallCap(env);
  const scratch = opts.scratchDir ?? (await mkdtemp(join(tmpdir(), "panoma-video-brain-")));
  const ledger: Ledger = { driver: driver.name, model, cap, calls: 0, cached: 0, failed: 0, ms: 0, entries: [] };

  const note = async (entry: LedgerEntry) => {
    ledger.entries.push(entry);
    ledger.ms += entry.ms;
    if (opts.logFile) await appendFile(opts.logFile, JSON.stringify(entry) + "\n").catch(() => undefined);
  };

  const brain: Brain = {
    driver: driver.name,
    model,
    how: found.how,
    ledger: () => ledger,
    async ask<T>(question: Asked<T>): Promise<Answer<T>> {
      const started = Date.now();
      const schema = zodToJsonSchema(question.shape, { name: "answer", $refStrategy: "none" }).definitions?.answer as Record<string, unknown> | undefined;
      const request = { kind: "brain", driver: driver.name, model, id: question.id, version: question.version, system: question.system, user: question.user, schema };
      let answeredBy = model;
      let hit = true;
      try {
        const { path } = await cached(opts.cacheDir, request, "json", async () => {
          hit = false;
          if (opts.signal?.aborted) throw new BrainDeclined("aborted", "the run was cancelled before the brain answered");
          if (ledger.calls >= cap) throw new BrainDeclined("cap", `the brain has made the calls one run may make; the template answers instead. Cap: ${cap}`);
          ledger.calls++;
          const ask: Ask = { system: question.system, user: question.user, schema: schema ?? { type: "object" }, model, timeoutMs: question.timeoutMs ?? opts.timeoutMs ?? BRAIN_TIMEOUT_MS, scratchDir: scratch, effort: question.effort, signal: opts.signal };
          const attempt = async (input: Ask): Promise<{ ok: true; data: T } | { ok: false; issues: string; detail: string }> => {
            let completion;
            try {
              reserveAppCall(driver.name, model);
              completion = await driver.complete(input);
              recordAppUsage(completion.usage);
            } catch (error) {
              if (!(error instanceof DriverAnswerInvalid)) throw error; // Transport, cancellation and schema construction are not answer failures.
              return { ok: false, issues: error.message, detail: error.message };
            }
            answeredBy = completion.model;
            const parsed = question.shape.safeParse(completion.json);
            if (parsed.success) return { ok: true, data: parsed.data };
            return {
              ok: false,
              issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; "),
              detail: `${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
            };
          };
          let result = await attempt(ask);
          if (!result.ok) {
            /* Decode and Zod failures share one correction, never an extra loop per layer. */
            result = await attempt({ ...ask, user: `${ask.user}\n\nYour previous answer did not fit the schema (${result.issues}). Answer again, JSON only, in exactly the shape asked for.` });
            if (!result.ok) throw new BrainAnswerInvalid(`the brain's answer to "${question.id}" did not fit its shape twice: ${result.detail}`);
          }
          return Buffer.from(JSON.stringify(result.data));
        });
        const value = question.shape.parse(JSON.parse(await readFile(path, "utf8")));
        if (hit) ledger.cached++;
        const ms = Date.now() - started;
        await note({ at: new Date().toISOString(), question: question.id, driver: driver.name, model: answeredBy, hit, ok: true, ms });
        return { value, hit, ms, model: answeredBy };
      } catch (e) {
        ledger.failed++;
        await note({ at: new Date().toISOString(), question: question.id, driver: driver.name, model: answeredBy, hit: false, ok: false, ms: Date.now() - started, note: (e as Error).message.split("\n")[0] });
        throw e;
      }
    },
  };
  /* A scratch directory this call made is this call's to remove; the process may be long-lived (the MCP server). */
  if (!opts.scratchDir) process.once("exit", () => void rm(scratch, { recursive: true, force: true }).catch(() => undefined));
  return { brain, why: "" };
}
