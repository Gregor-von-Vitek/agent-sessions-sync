import * as vscode from 'vscode';
import { SyncController } from '../sync/controller';
import { Agent, ConflictFile, ConflictResolution, UnitConflict } from '../sync/types';
import { describeUnit, repoPathToLocal } from '../util/paths';

export const REMOTE_SCHEME = 'agent-sessions-sync-remote';

/** Serves remote blob content (by sha) into VS Code's native diff editor. */
export class RemoteContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly controller: SyncController) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const sha = new URLSearchParams(uri.query).get('sha') ?? '';
    return this.controller.getRemoteFileText(sha);
  }
}

/** Interactive conflict resolution: pick a session → Compare / Keep Local / Use Remote. */
export async function resolveConflictsFlow(
  controller: SyncController,
  getAgents: () => Agent[],
  requestSync: (reason: string) => void
): Promise<void> {
  for (;;) {
    const conflicts = controller.getConflicts();
    if (conflicts.length === 0) {
      void vscode.window.showInformationMessage('No session conflicts. Everything is in sync.');
      return;
    }
    const agents = getAgents();
    const picked = await vscode.window.showQuickPick(
      conflicts.map((c) => ({
        label: `$(warning) ${describeUnit(agents, c.unit)}`,
        description: `${c.files.length} file(s)`,
        conflict: c,
      })),
      { title: 'Agent Sessions Sync — conflicting sessions', placeHolder: 'Select a session to resolve' }
    );
    if (!picked) {
      return;
    }
    const resolved = await resolveUnit(controller, agents, requestSync, picked.conflict);
    if (!resolved && controller.getConflicts().length <= 1) {
      return;
    }
  }
}

async function resolveUnit(
  controller: SyncController,
  agents: readonly Agent[],
  requestSync: (reason: string) => void,
  conflict: UnitConflict
): Promise<boolean> {
  for (;;) {
    const action = await vscode.window.showQuickPick(
      [
        { id: 'compare', label: '$(diff) Compare versions', description: 'Open the differences in a diff editor' },
        { id: 'local', label: '$(device-desktop) Keep local', description: "Overwrite the remote version with this machine's version" },
        { id: 'remote', label: '$(cloud-download) Use remote', description: 'Replace the local version (a backup is kept)' },
      ],
      {
        title: `Resolve conflict — ${describeUnit(agents, conflict.unit)}`,
        placeHolder: 'How do you want to resolve this conflict?',
      }
    );
    if (!action) {
      return false;
    }
    if (action.id === 'compare') {
      await compareFlow(agents, conflict);
      continue;
    }
    await controller.resolveConflict(conflict.unit, action.id as ConflictResolution);
    requestSync('conflict-resolution');
    return true;
  }
}

async function compareFlow(agents: readonly Agent[], conflict: UnitConflict): Promise<void> {
  const differing = conflict.files.filter((f) => f.localSha !== f.remoteSha);
  if (differing.length === 0) {
    return;
  }
  let file: ConflictFile | undefined = differing[0];
  if (differing.length > 1) {
    const picked = await vscode.window.showQuickPick(
      differing.map((f) => ({
        label: f.path,
        description:
          f.localSha === undefined ? 'deleted locally' : f.remoteSha === undefined ? 'deleted remotely' : 'modified on both sides',
        file: f,
      })),
      { title: `Compare — ${describeUnit(agents, conflict.unit)}`, placeHolder: 'Select a file to compare' }
    );
    file = picked?.file;
  }
  if (!file) {
    return;
  }

  const remoteUri = vscode.Uri.from({
    scheme: REMOTE_SCHEME,
    path: '/' + file.path,
    query: `sha=${file.remoteSha ?? ''}`,
  });
  const localFsPath = file.localSha !== undefined ? repoPathToLocal(agents, file.path) : undefined;
  const localUri = localFsPath
    ? vscode.Uri.file(localFsPath)
    : vscode.Uri.from({ scheme: REMOTE_SCHEME, path: '/' + file.path + ' (deleted locally)', query: 'sha=' });

  await vscode.commands.executeCommand('vscode.diff', remoteUri, localUri, `${file.path} (Remote ↔ Local)`);
}
