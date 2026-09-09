/*
  Path hygiene, learned from the ElevenLabs MCP's issue tracker (#77 relative output
  directories, #92 absolute paths escaping the base directory, #102 unsubstituted
  ${output_dir} placeholders): every path a tool takes is resolved to a real absolute
  path and must exist; every path a tool returns is absolute; nothing is ever written
  outside PANOMA_VIDEO_HOME. The project directory is the trust boundary — a tool may read it
  and start it, never write into it.
*/
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { videoHome } from "@panoma/video-director";

/* PANOMA_VIDEO_HOME is the director's to define; the server only enforces it. */
export { videoHome };

/** A project path, checked: absolute after resolution, existing, a directory. */
export async function resolveProject(path: string | undefined): Promise<string> {
  if (!path || !path.trim()) throw new Error("project_path is required: the absolute path of the project directory.");
  if (/\$\{?[A-Z_]+\}?/.test(path)) {
    throw new Error(`project_path "${path}" contains an unexpanded variable. Pass the real absolute path.`);
  }
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    throw new Error(`project_path "${abs}" does not exist.`);
  }
  if (!(await stat(real)).isDirectory()) throw new Error(`project_path "${real}" is not a directory.`);
  return real;
}

/** True when `path` lies inside `root` (both absolute), never for the root's siblings. */
export function inside(root: string, path: string): boolean {
  const r = root.endsWith(sep) ? root : root + sep;
  return path === root || path.startsWith(r);
}

/** An output path, refused unless it lands under PANOMA_VIDEO_HOME. */
export function assertOutput(path: string): string {
  const abs = resolve(path);
  if (!inside(videoHome(), abs)) {
    throw new Error(`Refusing to write outside PANOMA_VIDEO_HOME (${videoHome()}): ${abs}. Outputs only ever land under it.`);
  }
  return abs;
}
