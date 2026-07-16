import { RepoConfig } from '../sync/types';

/** README committed into the user's sessions repository when the extension creates/initializes it. */
export function repoReadmeContent(cfg: Pick<RepoConfig, 'owner' | 'repo'>): string {
  return `# Personal Agent Sessions

This repository stores AI agent session history (conversation transcripts), kept in sync
across machines by the **Agent Sessions Sync** VS Code extension.

- Each agent has its own top-level directory: \`claude/\`, \`codex/\`, \`cursor/\`.
- Commits are created automatically by the extension.
- You normally don't need to edit this repository manually — changes made here are
  downloaded to your machines on the next sync.

> ⚠️ Session transcripts contain your full AI conversations and may include sensitive
> data (code, credentials pasted into chats, …). Keep this repository **private**.
`;
}
