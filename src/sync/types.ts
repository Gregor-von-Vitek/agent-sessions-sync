/** Map of repository-relative path (e.g. `claude/my-project/1a2b3c.jsonl`) to git blob SHA. */
export type FileShaMap = Record<string, string>;

/**
 * A synchronized AI agent. Each agent maps one local sessions directory to one top-level
 * namespace (`repoDir`) in the repository, so multiple agents share one repo without collisions.
 */
export interface Agent {
  /** Stable identifier, e.g. `claude`, `codex`, `cursor`. */
  id: string;
  /** Human-readable name shown in the UI, e.g. `Claude Code`. */
  label: string;
  /** Top-level directory this agent's sessions live under in the repository. */
  repoDir: string;
  /** Absolute path to the agent's local sessions directory. */
  localPath: string;
  /**
   * How many leading path segments form this agent's sync/conflict unit.
   * `Infinity` → every file is its own unit. When the unit spans the whole path, the file
   * extension is stripped, so a session file and its sidecar directory
   * (`<id>.jsonl` + `<id>/subagents/…`) fold into a single unit.
   */
  unitDepth: number;
}

/** The GitHub repository + branch the user selected during setup. */
export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
}

export type ConflictResolution = 'local' | 'remote';

export interface ConflictFile {
  path: string;
  localSha?: string;
  remoteSha?: string;
  baseSha?: string;
}

/** A conflict aggregated at unit level, e.g. `claude/my-project/1a2b3c` (one session). */
export interface UnitConflict {
  unit: string;
  files: ConflictFile[];
}

export interface SyncPlan {
  /** Local content to commit to the remote repository. */
  uploads: string[];
  /** Paths to delete from the remote repository. */
  removeRemote: string[];
  /** Remote content to write to the local sessions directory. */
  downloads: string[];
  /** Paths to delete locally (backed up to trash first). */
  removeLocal: string[];
  /** Both sides changed to identical content — only the base state needs updating. */
  baseUpdates: string[];
  conflicts: UnitConflict[];
  /** Units left untouched this run (actively written or oversized files); BASE entries kept. */
  skipped: string[];
  /** Expected base (last-synced) state after the plan is executed. Conflicted and skipped paths keep their old base entry. */
  newBaseFiles: FileShaMap;
}

export type SyncStatus =
  | { kind: 'notConfigured' }
  | { kind: 'signInRequired' }
  | { kind: 'paused' }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: number; repo: string }
  | { kind: 'conflict'; units: string[] }
  | { kind: 'error'; message: string };
