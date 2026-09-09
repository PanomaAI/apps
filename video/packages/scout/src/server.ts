/*
  Start the product for the camera, on a port panoma video chose, bound to the loopback
  interface, and know when it is actually up.

  Three failures this file exists to prevent, each already paid for:
  - A guessed port. Vite moves to the next free port silently unless strictPort is
    set (https://vite.dev/config/server-options); a recording that opened 5173 then
    filmed a different project. The port is picked free here and forced through the
    framework's own flag, `$PORT` placeholder or environment variable.
  - A port the browser refuses. Chromium's fetch (and navigation) implements the Fetch
    Standard's bad-ports list — 6000, 6666, 4190 and seventy-nine others — and the failure is
    `ERR_UNSAFE_PORT` with no server-side trace. panoma hit exactly this: `panoma up`
    on 4190 "did not answer in 60 s" with the server alive and curl at 200. A free
    port on that list is skipped.
  - A recording of a blank page. "Up" is declared by the framework's readiness (an
    HTML answer on GET /, or an open socket), confirmed by polling, and a timeout
    fails WITH the last lines of stdout so the failure is diagnosable, not silent.

  `stop()` kills the whole process tree: a `pnpm run dev` is three processes deep,
  and killing the parent alone leaves the server holding the port for the next take.
  POSIX gets its own process group (detached + kill(-pid)); Windows gets `taskkill /T`.

  On Windows the launch itself is the hazard, not the kill: `resolveOnWindows` below
  records why a shell is reached for only when nothing else can run the file, and never
  to pass arguments.
*/
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import { request } from "node:http";
import { connect, createServer } from "node:net";
import { delimiter, resolve as resolvePath } from "node:path";
import type { ProjectProfile } from "./types.ts";
import { prepareRuntime } from "./runtime.ts";

/*
  Fetch Standard, "bad port" list, https://fetch.spec.whatwg.org/#port-blocking
  (as of 2026; the list changes rarely — 10080 was the last addition, for NAT slipstream).
*/
export const BAD_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

const HOST = "127.0.0.1";
/** Poll cadence: fast enough that readiness costs ≤250 ms of latency, slow enough not to log-spam a server. */
const POLL_MS = 250;
/** Default readiness budget. Next.js cold starts with Turbopack take 5–20 s; 60 s covers a first `pnpm dev` compiling. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** The stdout tail kept for the failure message and `log()`. */
const LOG_LINES = 200;
/** SIGTERM grace before SIGKILL: dev servers flush caches on exit; three seconds is ample and stays under a test's patience. */
const STOP_GRACE_MS = 3000;

export type RunningServer = {
  url: string;
  port: number;
  pid: number;
  stop(): Promise<void>;
  /** The last 200 lines of stdout + stderr, in order. */
  log(): string;
  /** Disposable checkout used by the child, removed by stop(). */
  runtimeDir: string;
};

export type StartOptions = {
  /** Force a port instead of picking a free one (tests). It is still checked against the bad-ports list. */
  port?: number;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Override the PANOMA_VIDEO_HOME/runtimes parent for a test or a managed workspace. */
  /** Where the disposable runtime clone goes. Required: the caller owns the engine's home. */
  runtimeBase: string;
};

/** A free port on 127.0.0.1 that a browser will agree to open. */
export async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 32; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const srv = createServer();
      srv.unref();
      srv.on("error", reject);
      srv.listen(0, HOST, () => {
        const addr = srv.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        srv.close(() => resolve(p));
      });
    });
    if (port > 1024 && !BAD_PORTS.has(port)) return port;
  }
  throw new Error("Could not find a free port the browser accepts after 32 attempts.");
}

const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\]):(\d{2,5})\b/;

/** The port a dev server printed ("Local: http://localhost:5174/"), if any — how a silent move is noticed. */
export function detectPort(text: string): number | undefined {
  const m = LOCAL_URL.exec(text);
  return m ? Number(m[1]) : undefined;
}

export function tcpOpen(port: number, host = HOST): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ port, host });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(1000, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/** GET / answers with an HTML document (any status: a dev 404 page is still "the server is up"). */
export function htmlAt(port: number, host = HOST): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host, port, path: "/", method: "GET", timeout: 2000, headers: { accept: "text/html" } }, (res) => {
      const type = String(res.headers["content-type"] ?? "");
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500 && /text\/html/i.test(type));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

class Tail {
  lines: string[] = [];
  private partial = "";
  push(chunk: string) {
    const parts = (this.partial + chunk).split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    for (const p of parts) {
      this.lines.push(p);
      if (this.lines.length > LOG_LINES) this.lines.shift();
    }
  }
  text(): string {
    return [...this.lines, ...(this.partial ? [this.partial] : [])].join("\n");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function killTree(child: ChildProcess, exited: Promise<unknown>, done: () => boolean, grouped: boolean): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    await Promise.race([exited, sleep(STOP_GRACE_MS)]);
    return;
  }
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(grouped ? -child.pid! : child.pid!, s);
    } catch {
      try {
        child.kill(s);
      } catch {
        /* already gone */
      }
    }
  };
  const alive = () => { try { process.kill(grouped ? -child.pid! : child.pid!, 0); return true; } catch { return false; } };
  signal("SIGTERM");
  const deadline = Date.now() + STOP_GRACE_MS;
  while (alive() && Date.now() < deadline) await sleep(25);
  if (alive()) { signal("SIGKILL"); await sleep(50); }
}

/*
  Windows launch. `shell: true` looked like the fix for a package-manager shim, and it is
  a trap: with a shell Node joins the command and its arguments with single spaces and
  hands cmd.exe the result verbatim — it never quotes them. So the argument
  `console.log('boom'); process.exit(3)` arrived at node as three separate arguments,
  node evaluated `console.log('boom')` alone, printed boom and exited 0. The start had
  died with code 3 and the camera reported code 0. Nothing swallowed the exit status;
  the child that ran was simply not the child we meant to run.

  A shell is genuinely needed, but for something much narrower. CreateProcess can only run
  a PE image — an .exe or a .com; everything else PATHEXT finds is run by cmd.exe through
  its file association, and `pnpm`, `npm`, `next` and `vite` on Windows are `.cmd` shims.
  Since the fix for CVE-2024-27980 Node refuses to spawn one of those without a shell at
  all. So resolve the command the way cmd.exe would — the working directory, then PATH,
  each name tried with every PATHEXT extension — and reach for cmd.exe only when the answer
  is not an executable image, over a line quoted here instead of not quoted by Node.
  Everything else is spawned directly, which is also how a missing command gets its ENOENT
  back: with a shell in the middle there is no ENOENT at all — cmd.exe starts fine and
  reports "is not recognized as an internal or external command" under an exit code of 1
  that belongs to the shell.
*/
/** What CreateProcess can execute on its own. Anything else PATHEXT resolves needs cmd.exe. */
const EXECUTABLE_IMAGE = /\.(?:exe|com)$/i;
/** What Windows uses when PATHEXT is unset; the tail of the real list runs scripts we never launch. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/* Windows environment names are case-insensitive and `process.env` honours that, but a
   plain object does not: an environment carrying `Path` reads as no PATH at all here. */
function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(env)) if (key.toLowerCase() === wanted) return env[key];
  return undefined;
}

/** The file cmd.exe would run for `command`, or undefined — and then the spawn itself reports ENOENT. */
function resolveOnWindows(command: string, cwd: string, env: Record<string, string | undefined>): string | undefined {
  const extensions = (envValue(env, "PATHEXT") ?? DEFAULT_PATHEXT).split(";").filter(Boolean);
  const named = extensions.some((ext) => command.toLowerCase().endsWith(ext.toLowerCase()));
  /* A command carrying a separator is a path, not a name: Windows does not search PATH for it. */
  const directories = /[\\/]/.test(command) ? [cwd] : [cwd, ...(envValue(env, "PATH") ?? "").split(delimiter).filter(Boolean)];
  for (const directory of directories) {
    const base = resolvePath(cwd, directory, command);
    for (const candidate of named ? [base] : extensions.map((ext) => base + ext)) {
      if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    }
  }
  return undefined;
}

/*
  Windows CRT argument quoting: a run of backslashes is doubled only where it precedes a
  quote or ends the argument. Every argument is wrapped, even one without a space, so that
  a metacharacter inside it stays inert while cmd.exe parses the line and again while a
  batch file re-expands `%*`. `%VAR%` still expands — cmd does that inside quotes too —
  and no dev-server flag has yet needed a literal percent sign.
*/
function quoteForCmd(argument: string): string {
  return `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
}

export async function startServer(profile: ProjectProfile, opts: StartOptions): Promise<RunningServer> {
  const start = profile.start;
  if (!start) throw new Error(`${profile.name} has no start command: kind is ${profile.kind}, and nothing in it declares a dev server.`);
  const port = opts.port ?? (await freePort());
  if (BAD_PORTS.has(port)) throw new Error(`Port ${port} is on the Fetch Standard bad-ports list; Chromium refuses it (ERR_UNSAFE_PORT).`);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const placeholder = start.args.some((a) => a.includes("$PORT"));
  const runtime = await prepareRuntime(profile, { baseDir: opts.runtimeBase });
  const args = start.args.map((a) => runtime.mapPath(a.replaceAll("$PORT", String(port))));
  if (!placeholder && start.portFlag) args.push(start.portFlag, String(port));
  const env: Record<string, string | undefined> = {
    ...runtime.env,
    // BROWSER=none: CRA, Gatsby and friends open a browser tab on start; a camera does not want one.
    BROWSER: "none",
    // Plain output: the readiness regex reads stdout, and colour codes split URLs.
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    HOST,
    ...opts.env,
  };
  if (start.envPort) env[start.envPort] = String(port);
  else if (!placeholder && !start.portFlag) env.PORT = String(port);

  const win = process.platform === "win32";
  const command = runtime.mapPath(start.command);
  const resolved = win ? resolveOnWindows(command, runtime.cwd, env) : undefined;
  const viaShell = resolved !== undefined && !EXECUTABLE_IMAGE.test(resolved);
  /* `/d` skips any AutoRun script the machine has; `/s` makes cmd strip exactly the outer
     pair of quotes and leave the rest of the line alone, which is what lets our own
     quoting survive. `windowsVerbatimArguments` then stops Node from re-quoting it. */
  const file = viaShell ? envValue(env, "COMSPEC") ?? "cmd.exe" : resolved ?? command;
  const argv = viaShell ? ["/d", "/s", "/c", `"${[resolved!, ...args].map(quoteForCmd).join(" ")}"`] : args;
  // The host guardian owns the MCP process group; a second group would escape its cleanup.
  /*
    Under the host the project's server is not put in a group of its own, so a plain `stop()`
    signals the direct child alone and its own children outlive it until the host's guardian takes
    the whole group down at the end of the job. Jobs run one at a time, so nothing is waiting on
    those seconds; were they ever to run concurrently this would have to be a group again.
   */
  const grouped = !win && !process.env.PANOMA_APP_JOB;
  let child: ChildProcess;
  try {
    child = spawn(file, argv, {
      cwd: runtime.cwd,
      env,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: viaShell,
      windowsHide: true,
    });
  } catch (error) { await runtime.cleanup(); throw error; }
  const tail = new Tail();
  child.stdout?.setEncoding("utf8").on("data", (d: string) => tail.push(d));
  child.stderr?.setEncoding("utf8").on("data", (d: string) => tail.push(d));

  let exitCode: number | null | undefined;
  let exitSignal: NodeJS.Signals | null = null;
  let spawnError: Error | undefined;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      resolve();
    });
    child.once("error", (e) => {
      spawnError = e;
      exitCode = -1;
      resolve();
    });
  });
  const done = () => exitCode !== undefined;
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => { await killTree(child, exited, done, grouped); await runtime.cleanup(); })();

  const deadline = Date.now() + timeoutMs;
  let livePort = port;
  /* Display only, and quoted: joining the arguments with plain spaces reads like a command
     line a person could paste, while naming a different command — which is how the exit
     code above went wrong in the first place, and how a test kept passing on the strength
     of a string the engine had echoed back to itself. */
  const commandLine = [command, ...args].map((part) => (/[\s"]/.test(part) ? JSON.stringify(part) : part)).join(" ");
  while (Date.now() < deadline) {
    if (done()) {
      const why = spawnError
        ? `could not be started (${spawnError.message})`
        : exitCode === null
          ? `was killed by ${exitSignal} before it was ready`
          : `exited with code ${exitCode} before it was ready`;
      await stop();
      throw new Error(`\`${commandLine}\` ${why}.\n--- last output ---\n${tail.text()}`);
    }
    const printed = detectPort(tail.text());
    if (printed && printed !== livePort) livePort = printed;
    const ready = start.readiness === "http" ? await htmlAt(livePort) : await tcpOpen(livePort);
    if (ready) {
      return {
        url: `http://${HOST}:${livePort}`,
        port: livePort,
        pid: child.pid ?? -1,
        runtimeDir: runtime.dir,
        stop,
        log: () => tail.text(),
      };
    }
    await sleep(POLL_MS);
  }
  await stop();
  throw new Error(
    `\`${commandLine}\` was not ready on port ${port} (${start.readiness}) within ${Math.round(timeoutMs / 1000)} s.\n--- last output ---\n${tail.text()}`,
  );
}
