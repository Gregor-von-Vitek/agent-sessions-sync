import * as vscode from 'vscode';
import { SyncStatus } from '../sync/types';

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem('agentSessionsSync.status', vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'Agent Sessions Sync';
    this.item.command = 'agentSessionsSync.openMenu';
    this.update({ kind: 'notConfigured' });
    this.item.show();
  }

  update(status: SyncStatus): void {
    this.item.backgroundColor = undefined;
    switch (status.kind) {
      case 'notConfigured':
        this.item.text = '$(cloud) Sessions: Set Up';
        this.item.tooltip = 'Agent Sessions Sync is not configured yet. Click to set up.';
        break;
      case 'signInRequired':
        this.item.text = '$(account) Sessions: Sign In';
        this.item.tooltip = 'GitHub sign-in is required to sync your sessions. Click to sign in.';
        break;
      case 'paused':
        this.item.text = '$(debug-pause) Session Sync Paused';
        this.item.tooltip = 'Automatic sync is paused. Click to sync now.';
        break;
      case 'syncing':
        this.item.text = '$(sync~spin) Syncing Sessions';
        this.item.tooltip = 'Synchronizing your sessions…';
        break;
      case 'synced':
        this.item.text = '$(check) Sessions Synced';
        this.item.tooltip = `Sessions are in sync with ${status.repo} (last sync ${new Date(status.at).toLocaleTimeString()}).`;
        break;
      case 'conflict':
        this.item.text = '$(warning) Session Conflict';
        this.item.tooltip = `Conflicting session(s): ${status.units.join(', ')}. Click to resolve.`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      case 'error':
        this.item.text = '$(error) Session Sync Error';
        this.item.tooltip = `Sync failed: ${status.message}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
