import * as os from 'node:os';
import * as path from 'node:path';
import { Agent } from '../sync/types';

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

/** Convert a path relative to an agent's local dir into its repository path (forward slashes). */
export function localRelToRepoPath(repoDir: string, rel: string): string {
  return `${repoDir}/${rel.split(path.sep).join('/')}`;
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

/** Map a repository path to the absolute local path inside the owning agent's dir, or undefined. */
export function repoPathToLocal(agents: readonly Agent[], repoPath: string): string | undefined {
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
  return path.join(agent.localPath, ...rest);
}
