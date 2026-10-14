import * as path from "node:path";

/** Resolve an agent's workspace-relative `rel` path (from `bwoc list/status`)
 *  under `root`. Returns undefined when `rel` is empty, absolute, or escapes the
 *  workspace (`..`), so callers never act on a directory outside it. Pure. */
export function agentDirIn(root: string, rel: string): string | undefined {
  if (!root || !rel || path.isAbsolute(rel)) {
    return undefined;
  }
  const base = path.resolve(root);
  const dir = path.resolve(base, rel);
  const inside = path.relative(base, dir);
  if (!inside || inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    return undefined;
  }
  return dir;
}
