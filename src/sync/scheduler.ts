import * as path from 'node:path';
import * as vscode from 'vscode';
import { SyncController } from './controller';
import { isIgnoredFileName } from './scanner';
import { Agent } from './types';

export interface SchedulerSettings {
  debounceMs: number;
  pollMs: number;
}

/**
 * Drives the controller: startup sync, file-watchers (one per agent dir) with debounce,
 * periodic remote poll. All runs go through a single queue — at most one sync at a time; a
 * request arriving mid-run schedules exactly one follow-up run.
 */
export class SyncScheduler implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private queuedReason?: string;
  private started = false;

  constructor(
    private readonly controller: SyncController,
    private readonly getAgents: () => Agent[],
    private readonly getSettings: () => SchedulerSettings,
    private readonly log: vscode.LogOutputChannel
  ) {}

  isStarted(): boolean {
    return this.started;
  }

  /** Enable automatic syncing: watchers + poll + an immediate startup sync. Idempotent. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.setupWatchers();
    this.setupPoll();
    this.requestSync('startup');
  }

  /** Re-create watchers and poll timer (agent dirs or intervals changed). */
  restart(): void {
    this.teardown();
    if (this.started) {
      this.setupWatchers();
      this.setupPoll();
    }
  }

  /** Queue a sync run. Safe to call whether or not automatic syncing is started. */
  requestSync(reason: string): void {
    if (this.running) {
      this.queuedReason = reason;
      return;
    }
    void this.runLoop(reason);
  }

  private async runLoop(reason: string): Promise<void> {
    this.running = true;
    try {
      let next: string | undefined = reason;
      while (next !== undefined) {
        this.queuedReason = undefined;
        await this.controller.sync(next);
        next = this.queuedReason;
      }
    } finally {
      this.running = false;
    }
  }

  private setupWatchers(): void {
    for (const agent of this.getAgents()) {
      const pattern = new vscode.RelativePattern(vscode.Uri.file(agent.localPath), '**/*');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const onEvent = (uri: vscode.Uri) => {
        if (this.controller.applyingLocalChanges) {
          return; // our own writes
        }
        if (isIgnoredFileName(path.basename(uri.fsPath))) {
          return;
        }
        this.scheduleDebounced();
      };
      watcher.onDidCreate(onEvent);
      watcher.onDidChange(onEvent);
      watcher.onDidDelete(onEvent);
      this.watchers.push(watcher);
      this.log.info(`Watching ${agent.localPath} (${agent.label})`);
    }
  }

  private scheduleDebounced(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.requestSync('file-change');
    }, this.getSettings().debounceMs);
  }

  private setupPoll(): void {
    const ms = this.getSettings().pollMs;
    if (ms > 0) {
      this.pollTimer = setInterval(() => this.requestSync('poll'), ms);
    }
  }

  private teardown(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  dispose(): void {
    this.teardown();
  }
}
