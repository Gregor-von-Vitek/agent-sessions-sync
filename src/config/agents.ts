import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { Agent, FolderMap } from '../sync/types';
import { buildFolderMap, expandUserPath } from '../util/paths';

interface KnownAgent {
  id: string;
  label: string;
  repoDir: string;
  /** Default local sessions directory (supports `~`). */
  defaultPath: string;
  /** Sync/conflict unit granularity — see `Agent.unitDepth`. */
  unitDepth: number;
}

/**
 * Agents the extension knows how to synchronize. Each maps to its own top-level namespace
 * in the repository so several agents can share one repo. Paths and enablement are configurable.
 *
 * Unit granularity per agent:
 * - claude: `~/.claude/projects/<project>/<session>.jsonl` (+ `<session>/subagents/…`,
 *   `<project>/memory/…`) → unit is `claude/<project>/<session>` (depth 3, extension stripped).
 * - codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, one file per session → every file
 *   is its own unit (depth ∞).
 * - cursor: `~/.cursor/chats/<session>/…` → unit is `cursor/<session>` (depth 2).
 */
export const KNOWN_AGENTS: readonly KnownAgent[] = [
  { id: 'claude', label: 'Claude Code', repoDir: 'claude', defaultPath: '~/.claude/projects', unitDepth: 3 },
  { id: 'codex', label: 'Codex', repoDir: 'codex', defaultPath: '~/.codex/sessions', unitDepth: Number.POSITIVE_INFINITY },
  { id: 'cursor', label: 'Cursor', repoDir: 'cursor', defaultPath: '~/.cursor/chats', unitDepth: 2 },
];

/** Build the list of enabled agents from settings, resolving each to an absolute local path. */
export function getEnabledAgents(): Agent[] {
  const cfg = vscode.workspace.getConfiguration('agentSessionsSync');
  const agents: Agent[] = [];
  for (const known of KNOWN_AGENTS) {
    if (!cfg.get<boolean>(`agents.${known.id}.enabled`, true)) {
      continue;
    }
    const configured = (cfg.get<string>(`agents.${known.id}.path`, '') ?? '').trim();
    const localPath = expandUserPath(configured || known.defaultPath);
    agents.push({
      id: known.id,
      label: known.label,
      repoDir: known.repoDir,
      localPath,
      unitDepth: known.unitDepth,
      folderMap: known.id === 'claude' ? claudeFolderMap(cfg, localPath) : undefined,
    });
  }
  return agents;
}

/** The claude agent's project-folder renaming from the `projectPaths` setting (see paths.ts). */
function claudeFolderMap(cfg: vscode.WorkspaceConfiguration, localPath: string): FolderMap | undefined {
  const entries = cfg.get<Record<string, string>>('agents.claude.projectPaths', {}) ?? {};
  if (Object.keys(entries).length === 0) {
    return undefined;
  }
  let localFolders: string[] = [];
  try {
    localFolders = fs.readdirSync(localPath);
  } catch {
    // missing sessions dir — no local folders to normalize or collide with
  }
  return buildFolderMap(entries, localFolders);
}
