import * as os from 'node:os';
import * as path from 'node:path';
import { Agent, FolderMap } from '../sync/types';

/** Expand a leading `~` and resolve to an absolute path. */
export function expandUserPath(p: string): string {
  const value = p.trim();
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

/**
 * The folder name Claude Code derives from a project's absolute path
 * (`~/.claude/projects/<slug>`): every non-alphanumeric character becomes `-`.
 * E.g. `C:\work\api` → `C--work-api`, `/home/alice/api` → `-home-alice-api`.
 */
export function claudeProjectSlug(absProjectPath: string): string {
  return absProjectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

/** True when `name` is usable as a single folder name inside a repository path. */
export function isSafeFolderName(name: string): boolean {
  return !name.includes('/') && areSegmentsSafe([name]);
}

/**
 * Build the folder renaming for the `projectPaths` setting: each entry maps a repository
 * folder name to a project directory on this machine, whose Claude slug becomes the local
 * folder name (case-normalized against `localFolders`, the actual entries of the sessions
 * dir, so Windows drive-letter casing can't split a project in two). An entry stays
 * inactive while a local folder with the repository name still exists — otherwise scans
 * would read the old folder while downloads write the new one; the Map Claude Project
 * Folder command migrates the old folder away.
 */
export function buildFolderMap(
  entries: Readonly<Record<string, string>>,
  localFolders: readonly string[]
): FolderMap | undefined {
  const byLower = new Map(localFolders.map((n) => [n.toLowerCase(), n]));
  const toLocal = new Map<string, string>();
  const toRepo = new Map<string, string>();
  for (const [repoFolder, localDir] of Object.entries(entries)) {
    if (!isSafeFolderName(repoFolder) || localDir.trim() === '' || byLower.has(repoFolder.toLowerCase())) {
      continue;
    }
    const slug = claudeProjectSlug(expandUserPath(localDir));
    const localFolder = byLower.get(slug.toLowerCase()) ?? slug;
    if (repoFolder === localFolder || toRepo.has(localFolder)) {
      continue;
    }
    toLocal.set(repoFolder, localFolder);
    toRepo.set(localFolder, repoFolder);
  }
  return toLocal.size > 0 ? { toLocal, toRepo } : undefined;
}

/** Convert a path relative to an agent's local dir into its repository path (forward slashes). */
export function localRelToRepoPath(repoDir: string, rel: string, toRepo?: ReadonlyMap<string, string>): string {
  const segments = rel.split(path.sep);
  const mapped = toRepo?.get(segments[0]);
  if (mapped !== undefined) {
    segments[0] = mapped;
  }
  return `${repoDir}/${segments.join('/')}`;
}

/**
 * The sync/conflict unit a repository path belongs to: its first `depth` segments.
 * When the unit spans the whole path (the path IS the unit), the file extension is stripped,
 * so `claude/proj/1a2b.jsonl` and `claude/proj/1a2b/subagents/x.jsonl` share the unit
 * `claude/proj/1a2b`. Dotfiles (`.foo`) keep their name.
 */
export function unitOf(repoPath: string, depth: number): string {
  const parts = repoPath.split('/');
  const take = Math.min(depth, parts.length);
  const segments = parts.slice(0, take);
  if (take === parts.length) {
    const last = segments[take - 1];
    const dot = last.lastIndexOf('.');
    if (dot > 0) {
      segments[take - 1] = last.slice(0, dot);
    }
  }
  return segments.join('/');
}

export type UnitFn = (repoPath: string) => string;

/** Unit resolver over a set of agents: the owning agent (by first segment) supplies the depth. */
export function makeUnitOf(agents: ReadonlyArray<Pick<Agent, 'repoDir' | 'unitDepth'>>): UnitFn {
  const depths = new Map(agents.map((a) => [a.repoDir, a.unitDepth]));
  return (repoPath) => {
    const repoDir = repoPath.split('/', 1)[0];
    return unitOf(repoPath, depths.get(repoDir) ?? Number.POSITIVE_INFINITY);
  };
}

/** Human label for a unit, e.g. `my-project/1a2b3c (Claude Code)`. */
export function describeUnit(agents: readonly Agent[], unit: string): string {
  const [repoDir, ...rest] = unit.split('/');
  const agent = agents.find((a) => a.repoDir === repoDir);
  if (rest.length === 0) {
    return unit;
  }
  const name = rest.join('/');
  return agent ? `${name} (${agent.label})` : `${name} (${repoDir})`;
}

function areSegmentsSafe(segments: string[]): boolean {
  return (
    segments.length > 0 &&
    segments.every((s) => s.length > 0 && s !== '.' && s !== '..' && !s.includes('\\') && !s.includes(':'))
  );
}

/**
 * True when a repository path is a safe sessions path: its first segment is a known agent
 * namespace, it has at least one more segment, and no segment can escape the target directory.
 */
export function isValidRepoPath(repoDirs: ReadonlySet<string>, repoPath: string): boolean {
  const parts = repoPath.split('/');
  if (parts.length < 2 || !repoDirs.has(parts[0])) {
    return false;
  }
  return areSegmentsSafe(parts.slice(1));
}

/** The owning agent and local path segments (below its root) for a repository path, or undefined. */
function resolveLocalSegments(
  agents: readonly Agent[],
  repoPath: string
): { agent: Agent; segments: string[] } | undefined {
  const parts = repoPath.split('/');
  if (parts.length < 2) {
    return undefined;
  }
  const [repoDir, ...rest] = parts;
  if (!areSegmentsSafe(rest)) {
    return undefined;
  }
  const agent = agents.find((a) => a.repoDir === repoDir);
  if (!agent) {
    return undefined;
  }
  const mapped = agent.folderMap?.toLocal.get(rest[0]);
  if (mapped !== undefined) {
    rest[0] = mapped;
  }
  return { agent, segments: rest };
}

/** Map a repository path to the absolute local path inside the owning agent's dir, or undefined. */
export function repoPathToLocal(agents: readonly Agent[], repoPath: string): string | undefined {
  const resolved = resolveLocalSegments(agents, repoPath);
  return resolved && path.join(resolved.agent.localPath, ...resolved.segments);
}

/** Map a repository path to its local path relative to the agent root (forward slashes), or undefined. */
export function repoPathToLocalRel(agents: readonly Agent[], repoPath: string): string | undefined {
  return resolveLocalSegments(agents, repoPath)?.segments.join('/');
}
