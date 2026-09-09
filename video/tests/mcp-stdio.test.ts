/*
  Over stdio, any byte on stdout that is not a JSON-RPC frame ends the session — and the
  render path logs. So the real binary is spawned, spoken to, and every line it writes
  is parsed. This is the test that turns a stray console.log into a failing build
  instead of a broken agent.

  It also has to fail when the server never starts, and for a long time it did not.
  `await once(proc, "close")` waits for an event that has already fired when the child
  dies immediately — a missing entry file, a syntax error, an import that throws — so the
  test hung forever instead of failing. It hung for thirty-eight minutes on 7-Sep-2026,
  when the entry file was renamed and this path was not, and the run had to be killed by
  hand. Meanwhile `stderr` was piped and never read, so the reason was on the floor.
  Both are fixed below: the exit is awaited only if it has not happened, and whatever the
  child said on stderr is what the failure reports.
*/
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../apps/cli/src/panoma-video.ts", import.meta.url));

test("panoma-video mcp speaks nothing but JSON-RPC on stdout and lists its tools in order", async () => {
  assert.ok(existsSync(CLI), `the entry file is not there: ${CLI}`);
  const proc = spawn(process.execPath, [CLI, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  let closed = false;
  proc.stdout.on("data", (d) => (out += d.toString()));
  proc.stderr.on("data", (d) => (err += d.toString()));
  proc.on("close", () => (closed = true));
  const send = (msg: unknown) => proc.stdin.write(JSON.stringify(msg) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const started = Date.now();
  while (!closed && !out.includes('"id":2') && Date.now() - started < 60_000) await new Promise((r) => setTimeout(r, 100));
  proc.stdin.end();
  if (!closed) await once(proc, "close");
  assert.ok(out.includes('"id":2'), `the server answered nothing in ${Math.round((Date.now() - started) / 1000)} s; it exited with ${proc.exitCode} and said on stderr: ${err.trim().slice(0, 400) || "(nothing)"}`);
  const lines = out.split("\n").filter((l) => l.trim());
  assert.ok(lines.length >= 2, `expected responses, got: ${out.slice(0, 200)}`);
  const parsed = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      throw new Error(`stdout carried a line that is not JSON-RPC: ${l.slice(0, 120)}`);
    }
  });
  const list = parsed.find((m) => m.id === 2);
  assert.ok(list?.result?.tools?.length >= 1);
  assert.equal(list.result.tools[0].name, "panoma_video_guide");
});
