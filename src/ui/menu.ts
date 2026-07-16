import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { SyncController } from '../sync/controller';
import { RepoConfig } from '../sync/types';

/** Status-bar click target: contextual quick menu with the current state in the title. */
export async function openMenu(
  controller: SyncController,
  getConfig: () => RepoConfig | undefined,
  requestSync: (reason: string) => void
): Promise<void> {
  const status = controller.getStatus();
  const cfg = getConfig();

  type Item = vscode.QuickPickItem & { action: () => Promise<void> | void };
  const items: Item[] = [];

  if (!cfg) {
    items.push({
      label: '$(plug) Set Up Agent Sessions Sync',
      detail: 'Connect GitHub and choose a repository for your session history.',
      action: () => vscode.commands.executeCommand('agentSessionsSync.setup') as Promise<void>,
    });
  } else {
    if (status.kind === 'signInRequired') {
      items.push({
        label: '$(account) Sign in to GitHub',
        action: async () => {
          const session = await getGitHubSession(true);
          if (session) {
            requestSync('sign-in');
          }
        },
      });
    }
    if (status.kind === 'conflict') {
      items.push({
        label: '$(warning) Resolve Conflicts',
        description: status.units.join(', '),
        action: () => vscode.commands.executeCommand('agentSessionsSync.resolveConflicts') as Promise<void>,
      });
    }
    items.push({
      label: '$(sync) Sync Now',
      action: () => vscode.commands.executeCommand('agentSessionsSync.syncNow') as Promise<void>,
    });
    items.push({
      label: '$(github) Open Repository on GitHub',
      description: `${cfg.owner}/${cfg.repo} @ ${cfg.branch}`,
      action: () => vscode.commands.executeCommand('agentSessionsSync.openRepository') as Promise<void>,
    });
    items.push({
      label: '$(plug) Change Repository…',
      action: () => vscode.commands.executeCommand('agentSessionsSync.setup') as Promise<void>,
    });
  }
  items.push({
    label: '$(output) Show Log',
    action: () => vscode.commands.executeCommand('agentSessionsSync.showLog') as Promise<void>,
  });
  items.push({
    label: '$(settings-gear) Settings',
    action: () => vscode.commands.executeCommand('workbench.action.openSettings', 'agentSessionsSync') as Promise<void>,
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: `Agent Sessions Sync — ${describeStatus(status)}`,
  });
  await picked?.action();
}

function describeStatus(status: ReturnType<SyncController['getStatus']>): string {
  switch (status.kind) {
    case 'notConfigured':
      return 'not configured';
    case 'signInRequired':
      return 'GitHub sign-in required';
    case 'paused':
      return 'paused';
    case 'syncing':
      return 'syncing…';
    case 'synced':
      return `in sync with ${status.repo}`;
    case 'conflict':
      return `conflict in: ${status.units.join(', ')}`;
    case 'error':
      return `error — ${status.message}`;
  }
}
