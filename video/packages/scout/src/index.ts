/*
  @panoma/video-scout — understand a project on disk without a model.

  One call, `scoutProject(root)`, returns the ProjectProfile: kind, framework, package
  manager, a start command that accepts a forced port, the routes read from file
  conventions, the documents, the git window, and a fact sheet where every string
  a video may state has a source. `startServer(profile)` then runs it on a free port
  bound to 127.0.0.1 and reports when it is really up. Nothing here needs a browser
  or a key, so the automatic path never waits on either.
*/
export { scoutProject, makeContext, packageManagerOf, logoFilesOf, DEFAULT_DAYS } from "./profile.ts";
export type { PackageJson } from "./profile.ts";
export { factSheet } from "./facts.ts";
export { FRAMEWORKS, detectFramework, frameworkById, devArgv, isStatic } from "./frameworks.ts";
export type { FrameworkRule, DetectContext, StaticRule, Ecosystem } from "./frameworks.ts";
export { discoverRoutes, ROUTE_CAP } from "./routes.ts";
export { parseReadme, parseChangelog, stripBadges, plain } from "./markdown.ts";
export type { ReadmeParse, ChangelogParse, Located } from "./markdown.ts";
export { gitInfo, worktreeDigest, TAG_COUNT } from "./git.ts";
export type { GitInfo } from "./git.ts";
export { startServer, freePort, detectPort, tcpOpen, htmlAt, BAD_PORTS } from "./server.ts";
export type { RunningServer, StartOptions } from "./server.ts";
export { corepackHome, prepareRuntime } from "./runtime.ts";
export type { PreparedRuntime } from "./runtime.ts";
export { walk, readText, readJson, isEnvFile, slug, SKIP_DIRS } from "./fs.ts";
export type { ProjectProfile, ProjectKind, PackageManager, RunCommand, StartSpec, Route } from "./types.ts";
