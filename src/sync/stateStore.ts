import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FileShaMap, RepoConfig } from './types';

export interface BaseState {
  owner: string;
  repo: string;
  branch: string;
  /** Head commit sha of the branch at the time of the last successful sync. */
  commitSha: string | null;
  /** Last-synced (BASE) file state. */
  files: FileShaMap;
}

/**
 * Persists the BASE (last-synced) state in the extension's global storage.
 * The state is keyed by repo + branch: switching repositories starts from an empty base.
 */
export class StateStore {
  constructor(private readonly storageDir: string) {}

  private get filePath(): string {
    return path.join(this.storageDir, 'syncState.json');
  }

  async load(cfg: RepoConfig): Promise<BaseState> {
    const empty: BaseState = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, commitSha: null, files: {} };
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch {
      return empty;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<BaseState>;
      if (
        parsed.owner === cfg.owner &&
        parsed.repo === cfg.repo &&
        parsed.branch === cfg.branch &&
        parsed.files &&
        typeof parsed.files === 'object'
      ) {
        return {
          owner: cfg.owner,
          repo: cfg.repo,
          branch: cfg.branch,
          commitSha: typeof parsed.commitSha === 'string' ? parsed.commitSha : null,
          files: parsed.files as FileShaMap,
        };
      }
    } catch {
      // corrupt state file → start fresh
    }
    return empty;
  }

  async save(state: BaseState): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
    const tmp = this.filePath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }

  async reset(): Promise<void> {
    try {
      await fs.rm(this.filePath, { force: true });
    } catch {
      // ignore
    }
  }
}
