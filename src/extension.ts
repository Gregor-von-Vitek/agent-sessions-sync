import * as path from 'node:path';
import * as vscode from 'vscode';
import { getEnabledAgents } from './config/agents';
import { SyncController } from './sync/controller';
import { SyncScheduler } from './sync/scheduler';
import { StateStore } from './sync/stateStore';
import { Trash } from './sync/trash';
import { Agent, RepoConfig } from './sync/types';
import { RemoteContentProvider, REMOTE_SCHEME, resolveConflictsFlow } from './ui/conflicts';
import { openMenu } from './ui/menu';
import { mapClaudeProjectFlow } from './ui/projectMap';
import { runSetupWizard } from './ui/setupWizard';
import { StatusBar } from './ui/statusBar';

const KEY_REPO = 'agentSessionsSync.repo';
const KEY_CONFIRMED = 'agentSessionsSync.initialSyncConfirmed';
const KEY_WELCOMED = 'agentSessionsSync.welcomed';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Agent Sessions Sync', { log: true });

  const getConfig = (): RepoConfig | undefined => context.globalState.get<RepoConfig>(KEY_REPO);
  const settings = () => vscode.workspace.getConfiguration('agentSessionsSync');
  const getAgents = (): Agent[] => getEnabledAgents();
  const autoSyncEnabled = (): boolean => settings().get<boolean>('autoSync', true);

  const storageDir = context.globalStorageUri.fsPath;
  const stateStore = new StateStore(storageDir);
  const trash = new Trash(path.join(storageDir, 'trash'), log);
  const controller = new SyncController(
    getConfig,
    getAgents,
    () => ({
      freshMs: Math.max(0, settings().get<number>('freshMinutes', 5)) * 60_000,
      maxFileSize: Math.max(1, settings().get<number>('maxFileSizeMB', 50)) * 1024 * 1024,
    }),
    stateStore,
    trash,
    log
  );
  const statusBar = new StatusBar();
  const scheduler = new SyncScheduler(
    controller,
    getAgents,
    () => ({
      debounceMs: Math.max(1, settings().get<number>('debounceSeconds', 30)) * 1000,
      pollMs: Math.max(1, settings().get<number>('pollIntervalMinutes', 5)) * 60_000,
    }),
    log
  );
  controller.setSyncRequester((reason) => scheduler.requestSync(reason));
  context.globalState.setKeysForSync([KEY_REPO]);

  context.subscriptions.push(
    log,
    statusBar,
    scheduler,
    controller,
    controller.onDidChangeStatus((s) => statusBar.update(s)),
    vscode.workspace.registerTextDocumentContentProvider(REMOTE_SCHEME, new RemoteContentProvider(controller))
  );

  const startOrRequest = (reason: string): void => {
    if (!scheduler.isStarted() && autoSyncEnabled()) {
      scheduler.start(); // includes an initial sync
    } else {
      scheduler.requestSync(reason);
    }
  };

  const runSetupFlow = async (): Promise<void> => {
    const previous = getConfig();
    const cfg = await runSetupWizard(log);
    if (!cfg) {
      return;
    }
    const changed =
      !previous || previous.owner !== cfg.owner || previous.repo !== cfg.repo || previous.branch !== cfg.branch;
    await context.globalState.update(KEY_REPO, cfg);
    if (changed) {
      await controller.resetAfterRepoChange();
    }

    let counts: { localUnits: number; remoteUnits: number };
    try {
      counts = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Agent Sessions Sync: checking your sessions…' },
        () => controller.getFirstSyncCounts()
      );
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Agent Sessions Sync: could not read the repository state: ${e instanceof Error ? e.message : String(e)}`
      );
      return;
    }

    const { localUnits, remoteUnits } = counts;
    let confirmed = true;
    if (localUnits > 0 && remoteUnits === 0) {
      confirmed =
        (await vscode.window.showInformationMessage(
          `${localUnits} local session(s) found. Upload them to ${cfg.owner}/${cfg.repo}?`,
          { modal: true },
          'Upload'
        )) === 'Upload';
    } else if (remoteUnits > 0 && localUnits === 0) {
      confirmed =
        (await vscode.window.showInformationMessage(
          `${remoteUnits} session(s) available remotely. Download now?`,
          { modal: true },
          'Download'
        )) === 'Download';
    } else if (localUnits > 0 && remoteUnits > 0) {
      confirmed =
        (await vscode.window.showInformationMessage(
          `Found ${localUnits} local and ${remoteUnits} remote session(s). Merge and sync now? Conflicting sessions will be shown for review.`,
          { modal: true },
          'Sync'
        )) === 'Sync';
    }

    await context.globalState.update(KEY_CONFIRMED, confirmed);
    if (confirmed) {
      startOrRequest('setup');
    } else {
      controller.setPaused();
      void vscode.window.showInformationMessage(
        "Setup saved. Run 'Agent Sessions Sync: Sync Now' whenever you're ready — your sessions are stored in your own GitHub repository."
      );
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('agentSessionsSync.setup', runSetupFlow),
    vscode.commands.registerCommand('agentSessionsSync.syncNow', async () => {
      if (!getConfig()) {
        await runSetupFlow();
        return;
      }
      await context.globalState.update(KEY_CONFIRMED, true);
      startOrRequest('manual');
    }),
    vscode.commands.registerCommand('agentSessionsSync.resolveConflicts', () =>
      resolveConflictsFlow(controller, getAgents, (reason) => scheduler.requestSync(reason))
    ),
    vscode.commands.registerCommand('agentSessionsSync.mapClaudeProject', () =>
      mapClaudeProjectFlow(controller, getConfig, getAgents, log)
    ),
    vscode.commands.registerCommand('agentSessionsSync.openRepository', () => {
      const cfg = getConfig();
      if (cfg) {
        void vscode.env.openExternal(
          vscode.Uri.parse(`https://github.com/${cfg.owner}/${cfg.repo}/tree/${cfg.branch}`)
        );
      }
    }),
    vscode.commands.registerCommand('agentSessionsSync.showLog', () => log.show()),
    vscode.commands.registerCommand('agentSessionsSync.openMenu', () =>
      openMenu(controller, getConfig, (reason) => scheduler.requestSync(reason))
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentSessionsSync')) {
        scheduler.restart();
        if (autoSyncEnabled() && getConfig() && context.globalState.get<boolean>(KEY_CONFIRMED)) {
          scheduler.start();
        }
      }
    }),
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === 'github' && getConfig() && scheduler.isStarted()) {
        scheduler.requestSync('auth-change');
      }
    })
  );

  // Startup behaviour.
  const cfg = getConfig();
  if (cfg && autoSyncEnabled() && context.globalState.get<boolean>(KEY_CONFIRMED)) {
    scheduler.start();
  } else if (cfg) {
    controller.setPaused();
  } else if (!context.globalState.get<boolean>(KEY_WELCOMED)) {
    void context.globalState.update(KEY_WELCOMED, true);
    void vscode.window
      .showInformationMessage(
        'Agent Sessions Sync keeps your AI agent sessions in sync across your machines — stored in your own GitHub repository.',
        'Set Up'
      )
      .then((choice) => {
        if (choice === 'Set Up') {
          void vscode.commands.executeCommand('agentSessionsSync.setup');
        }
      });
  }

  log.info(
    `Agent Sessions Sync activated. Agents: ${getAgents()
      .map((a) => `${a.label} → ${a.localPath}`)
      .join(', ')}`
  );
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions.
}
