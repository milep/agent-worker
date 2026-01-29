import path from "node:path";

export const resolveWorkspaceCwd = (workspaceRoot: string, cwd?: string): string | null => {
  const resolvedRoot = path.resolve(workspaceRoot);
  const target = cwd ? path.resolve(resolvedRoot, cwd) : resolvedRoot;
  const relative = path.relative(resolvedRoot, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return target;
};
