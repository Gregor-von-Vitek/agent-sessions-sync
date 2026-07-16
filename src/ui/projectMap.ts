import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SyncController } from '../sync/controller';
import { Agent, RepoConfig } from '../sync/types';
import { claudeProjectSlug, expandUserPath } from '../util/paths';

/**
 * "Map Claude Project Folder": point a project folder in the repository (named after another
 * machine's absolute project path) at the project's directory on this machine, so its sessions
 * land where `claude --resume` looks for them. Writes the `agents.claude.projectPaths` setting
 * and moves any already-downloaded sessions from the old (repository-named) local folder into
 * the mapped one — the mapping stays inactive while that old folder exists.
 */
export async function mapClaudeProjectFlow(
  controller: SyncController,
  getConfig: () => RepoConfig | undefined,
  getAgents: () => Agent[],
  log: vscode.LogOutputChannel
): Promise<void> {
  if (!getConfig()) {
    const choice = await vscode.window.showInformationMessage(
      'Agent Sessions Sync is not set up yet. Set up a repository first.',
      'Set Up'
    );
    if (choice === 'Set Up') {
      await vscode.commands.executeCommand('agentSessionsSync.setup');
    }
    return;
  }
  const claude = getAgents().find((a) => a.id === 'claude');
  if (!claude) {
    void vscode.window.showWarningMessage('Claude Code sync is disabled — enable it in the settings first.');
    return;
  }

  let remoteFolders: string[];
  try {
    remoteFolders = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Agent Sessions Sync: reading repository projects…' },
      () => controller.listRemoteFolders(claude.repoDir)
    );
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Agent Sessions Sync: could not list repository projects: ${e instanceof Error ? e.message : String(e)}`
    );
    return;
  }
  if (remoteFolders.length === 0) {
    void vscode.window.showInformationMessage('No Claude Code projects in the repository yet — sync first.');
    return;
  }

  const settings = vscode.workspace.getConfiguration('agentSessionsSync');
  const mappings = settings.get<Record<string, string>>('agents.claude.projectPaths', {}) ?? {};
  const localFolders = await listDir(claude.localPath);
  const localByLower = new Map(localFolders.map((n) => [n.toLowerCase(), n]));

  const repoFolder = await pickRepoFolder(remoteFolders, mappings, localByLower);
  if (!repoFolder) {
    return;
  }
  const targetDir = await pickLocalProjectDir(repoFolder);
  if (!targetDir) {
    return;
  }

  const slug = claudeProjectSlug(expandUserPath(targetDir));
  const localFolder = localByLower.get(slug.toLowerCase()) ?? slug;
  if (localFolder === repoFolder) {
    void vscode.window.showInformationMessage(
      `'${targetDir}' already produces the folder '${repoFolder}' — the project lives at the same path here, no mapping needed.`
    );
    return;
  }

  // Move sessions already downloaded into the repository-named folder before activating the
  // mapping, so the next scan sees one consistent location. The watcher must ignore the moves.
  const oldDir = path.join(claude.localPath, localByLower.get(repoFolder.toLowerCase()) ?? repoFolder);
  let leftovers = 0;
  if (await exists(oldDir)) {
    controller.applyingLocalChanges = true;
    try {
      leftovers = await moveContents(oldDir, path.join(claude.localPath, localFolder));
    } finally {
      controller.applyingLocalChanges = false;
    }
    log.info(`Moved downloaded sessions ${oldDir} → ${path.join(claude.localPath, localFolder)}`);
  }

  await settings.update(
    'agents.claude.projectPaths',
    { ...mappings, [repoFolder]: targetDir },
    vscode.ConfigurationTarget.Global
  );
  log.info(`Mapped repository project folder '${repoFolder}' to ${targetDir} (local folder '${localFolder}')`);

  if (leftovers > 0) {
    void vscode.window.showWarningMessage(
      `Mapping saved, but ${leftovers} file(s) already existed in '${localFolder}' and were left in '${oldDir}'. ` +
        'The mapping stays inactive until that folder is removed.'
    );
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    `Mapped '${repoFolder}' → ${targetDir}. This project's sessions now sync into '${localFolder}', where 'claude --resume' finds them.`,
    'Sync Now'
  );
  if (choice === 'Sync Now') {
    await vscode.commands.executeCommand('agentSessionsSync.syncNow');
  }
}

async function pickRepoFolder(
  remoteFolders: string[],
  mappings: Record<string, string>,
  localByLower: ReadonlyMap<string, string>
): Promise<string | undefined> {
  type Item = vscode.QuickPickItem & { folder: string; unmatched: boolean };
  const items: Item[] = remoteFolders.map((folder) => {
    const mapped = mappings[folder];
    const local = localByLower.has(folder.toLowerCase());
    const description = mapped
      ? `currently mapped to ${mapped}`
      : local
        ? 'matches a local project folder'
        : 'not on this machine — backup only';
    return { label: folder, description, folder, unmatched: !mapped && !local };
  });
  items.sort((a, b) => Number(b.unmatched) - Number(a.unmatched) || a.folder.localeCompare(b.folder));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Map Claude Project Folder',
    placeHolder: 'Repository project folder to map (named after the project path on another machine)',
    matchOnDescription: true,
  });
  return picked?.folder;
}

async function pickLocalProjectDir(repoFolder: string): Promise<string | undefined> {
  type Item = vscode.QuickPickItem & { dir?: string };
  const items: Item[] = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    label: `$(root-folder) ${f.name}`,
    description: f.uri.fsPath,
    dir: f.uri.fsPath,
  }));
  items.push({ label: '$(folder-opened) Browse…' });
  const picked = await vscode.window.showQuickPick(items, {
    title: `Where does '${repoFolder}' live on this machine?`,
    placeHolder: "The project's directory on this machine (not the sessions directory)",
  });
  if (!picked) {
    return undefined;
  }
  if (picked.dir) {
    return picked.dir;
  }
  const chosen = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Map to This Folder',
  });
  return chosen?.[0]?.fsPath;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move `src`'s contents into `dst` (created if missing). Files already present in `dst` are
 * never overwritten — they stay behind in `src` and are counted. Emptied directories are removed.
 */
async function moveContents(src: string, dst: string): Promise<number> {
  let leftovers = 0;
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      leftovers += await moveContents(from, to);
    } else if (await exists(to)) {
      leftovers++;
    } else {
      await fs.rename(from, to);
    }
  }
  try {
    await fs.rmdir(src);
  } catch {
    // not empty — leftovers remain
  }
  return leftovers;
}
