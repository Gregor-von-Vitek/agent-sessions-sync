import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { GitHubClient, RepoInfo } from '../github/client';
import { repoReadmeContent } from '../util/repoTemplate';
import { RepoConfig } from '../sync/types';

const CREATE_NEW_ID = '$create-new$';

/**
 * Multi-step setup: Sign in with GitHub → select (or create) a repository → select a branch.
 * Returns the chosen configuration, or undefined when the user cancels any step.
 */
export async function runSetupWizard(log: vscode.LogOutputChannel): Promise<RepoConfig | undefined> {
  const session = await getGitHubSession(true);
  if (!session) {
    return undefined;
  }
  const client = new GitHubClient(session.accessToken, (m) => log.debug(m));

  const repos = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Agent Sessions Sync: loading your repositories…' },
    () => client.listRepos()
  );

  type RepoItem = vscode.QuickPickItem & { id: string; repo?: RepoInfo };
  const items: RepoItem[] = [
    {
      id: CREATE_NEW_ID,
      label: '$(add) Create a new private repository…',
      detail: 'Creates a repository on your GitHub account to store your session history.',
      alwaysShow: true,
    },
    { id: '', label: '', kind: vscode.QuickPickItemKind.Separator },
    ...repos.map((r) => ({
      id: r.full_name,
      repo: r,
      label: `${r.private ? '$(lock) ' : '$(repo) '}${r.full_name}`,
      description: r.default_branch,
      detail: r.description ?? undefined,
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Agent Sessions Sync — select a repository for your session history',
    placeHolder: 'A private repository is strongly recommended — sessions contain full conversations',
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return undefined;
  }

  if (picked.id === CREATE_NEW_ID) {
    return createRepoFlow(client, log);
  }

  const repo = picked.repo!;
  if (!repo.private) {
    const proceed = await vscode.window.showWarningMessage(
      `'${repo.full_name}' is a public repository. Session transcripts contain your full AI conversations and may include sensitive data — a private repository is strongly recommended.`,
      { modal: true },
      'Use Public Repository'
    );
    if (proceed !== 'Use Public Repository') {
      return undefined;
    }
  }
  const branch = await pickBranch(client, repo);
  if (!branch) {
    return undefined;
  }
  return { owner: repo.owner.login, repo: repo.name, branch };
}

async function createRepoFlow(client: GitHubClient, log: vscode.LogOutputChannel): Promise<RepoConfig | undefined> {
  const name = await vscode.window.showInputBox({
    title: 'Name for the new private repository',
    value: 'my-agent-sessions',
    ignoreFocusOut: true,
    validateInput: (value) =>
      /^[A-Za-z0-9_.-]{1,100}$/.test(value.trim())
        ? undefined
        : 'Use letters, numbers, hyphens, underscores or dots (max 100 characters).',
  });
  if (!name) {
    return undefined;
  }
  const repo = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating repository '${name.trim()}'…` },
    async () => {
      const created = await client.createRepo(name.trim(), 'AI agent session history — synced by Agent Sessions Sync');
      // Initialize with a README so the default branch exists (with a small retry:
      // GitHub occasionally needs a moment before a fresh repository accepts writes).
      const readme = Buffer.from(repoReadmeContent({ owner: created.owner.login, repo: created.name }), 'utf8');
      for (let attempt = 1; ; attempt++) {
        try {
          await client.createFileViaContents(created.owner.login, created.name, 'README.md', readme, 'Initialize Agent Sessions Sync');
          break;
        } catch (e) {
          if (attempt >= 3) {
            throw e;
          }
          log.warn(`README init attempt ${attempt} failed, retrying… (${String(e)})`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
      return created;
    }
  );
  return { owner: repo.owner.login, repo: repo.name, branch: repo.default_branch || 'main' };
}

async function pickBranch(client: GitHubClient, repo: RepoInfo): Promise<string | undefined> {
  const branches = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Loading branches…' },
    () => client.listBranches(repo.owner.login, repo.name)
  );
  if (branches.length === 0) {
    // Empty repository — the branch will be created on the first sync.
    return repo.default_branch || 'main';
  }
  if (branches.length === 1) {
    return branches[0].name;
  }
  const items = branches
    .map((b) => ({
      label: b.name,
      description: b.name === repo.default_branch ? 'default branch' : undefined,
    }))
    .sort((a, b) => (a.description ? -1 : b.description ? 1 : a.label.localeCompare(b.label)));
  const picked = await vscode.window.showQuickPick(items, {
    title: `Agent Sessions Sync — select a branch in ${repo.full_name}`,
    ignoreFocusOut: true,
  });
  return picked?.label;
}
