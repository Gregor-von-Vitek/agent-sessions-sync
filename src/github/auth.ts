import * as vscode from 'vscode';

const PROVIDER = 'github';
const SCOPES = ['repo'];

/**
 * Get a GitHub session via VS Code's built-in GitHub authentication provider.
 * No custom OAuth app is needed; VS Code manages the token securely.
 *
 * - `interactive: true` shows the sign-in flow when there is no session (setup wizard).
 * - `interactive: false` never prompts (background syncs); returns undefined when signed out.
 */
export async function getGitHubSession(interactive: boolean): Promise<vscode.AuthenticationSession | undefined> {
  if (interactive) {
    return vscode.authentication.getSession(PROVIDER, SCOPES, { createIfNone: true });
  }
  return vscode.authentication.getSession(PROVIDER, SCOPES, { silent: true });
}
