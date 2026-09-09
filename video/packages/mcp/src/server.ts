#!/usr/bin/env node
/*
  The stdio entry point: `panoma-video mcp` runs this. Everything is in startStdio, so the CLI
  and this bin share one implementation.
*/
import { startStdio } from "./index.ts";

await startStdio();
