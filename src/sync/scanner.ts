import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { localRelToRepoPath } from '../util/paths';
import { Agent, FileShaMap } from './types';

const IGNORED_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const IGNORED_DIRS = new Set(['.git']);

export function isIgnoredFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return IGNORED_FILES.has(lower) || lower.endsWith('.tmp');
}

/** Git blob SHA-1 of the content — identical to what GitHub reports for the same bytes. */
export function gitBlobSha(content: Buffer): string {
  const hash = createHash('sha1');
  hash.update(`blob ${content.length}\0`);
  hash.update(content);
  return hash.digest('hex');
}

export interface ScanOptions {
  /** Files modified within this window are reported in `fresh` (actively-written sessions). 0/undefined disables. */
  freshMs?: number;
  /** Files larger than this many bytes are not read or hashed; reported in `oversized`. */
  maxFileSize?: number;
  /** Clock override for tests. */
  now?: number;
}

export interface ScanResult {
  files: FileShaMap;
  /** Repo paths of files modified within `freshMs` (still hashed and present in `files`). */
  fresh: Set<string>;
  /** Repo paths of files skipped for exceeding `maxFileSize` (absent from `files`). */
  oversized: Set<string>;
}

/** Recursively scan one agent directory, adding `<repoDir>/<rel>` entries to `result`. */
async function scanDir(agent: Agent, result: ScanResult, options: ScanOptions): Promise<void> {
  async function walk(absDir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw e;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const childRel = rel ? `${rel}${path.sep}${entry.name}` : entry.name;
      const childAbs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name.toLowerCase())) {
          continue;
        }
        await walk(childAbs, childRel);
      } else if (entry.isFile()) {
        if (isIgnoredFileName(entry.name)) {
          continue;
        }
        const repoPath = localRelToRepoPath(agent.repoDir, childRel, agent.folderMap?.toRepo);
        const stat = await fs.stat(childAbs);
        if (options.maxFileSize !== undefined && stat.size > options.maxFileSize) {
          result.oversized.add(repoPath);
          continue;
        }
        if (options.freshMs !== undefined && options.freshMs > 0) {
          const now = options.now ?? Date.now();
          if (now - stat.mtimeMs < options.freshMs) {
            result.fresh.add(repoPath);
          }
        }
        const content = await fs.readFile(childAbs);
        result.files[repoPath] = gitBlobSha(content);
      }
    }
  }
  await walk(agent.localPath, '');
}

/**
 * Scan every agent's local sessions directory into a single repository-path → git blob sha map.
 * Missing directories contribute nothing (so agents the user doesn't use are simply empty).
 */
export async function scanAgents(agents: readonly Agent[], options: ScanOptions = {}): Promise<ScanResult> {
  const result: ScanResult = { files: {}, fresh: new Set(), oversized: new Set() };
  for (const agent of agents) {
    await scanDir(agent, result, options);
  }
  return result;
}
