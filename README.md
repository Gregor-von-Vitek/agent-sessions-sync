# Agent Sessions Sync

Keep your AI agent **sessions** (conversation history) synchronized across all of your
computers — through your **own private GitHub repository**. No third-party backend, no
local git required, zero runtime dependencies.

Sister extension of [Agent Skills Sync](https://github.com/Gregor-von-Vitek/agent-skills-sync)
(which syncs skills; this one syncs session history).

## What it syncs

| Agent | Default local directory | Layout in your repo |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` | `claude/<project>/<session>.jsonl` (+ subagent logs, project `memory/`) |
| Codex | `~/.codex/sessions` | `codex/<YYYY>/<MM>/<DD>/rollout-*.jsonl` |
| Cursor | `~/.cursor/chats` | `cursor/<session>/…` |

Each agent can be disabled or repointed in the settings
(`agentSessionsSync.agents.<id>.enabled` / `.path`). A missing directory simply contributes
nothing, so unused agents are invisible.

## How it works

1. Run **Agent Sessions Sync: Set Up / Change Repository** (or click the status bar item).
2. Sign in with GitHub (VS Code's built-in auth — no separate token needed) and pick or
   create a **private** repository.
3. That's it. Sessions sync automatically on startup, when session files change (debounced),
   and periodically. The extension performs a 3-way merge (local / remote / last-synced
   state), so machines can go offline and catch up safely.

- **Never silently overwrites.** If the same session changed on two machines, it's surfaced
  as a conflict you resolve per session (Compare / Keep Local / Use Remote). Everything else
  keeps syncing meanwhile.
- **Active sessions are left alone.** Files modified within the last few minutes
  (`freshMinutes`, default 5) are skipped in both directions until the conversation settles,
  so a running agent is never disturbed and you don't get a commit per message.
- **Deletions are backed up.** Before a session is deleted or overwritten locally, it's
  copied to a local trash (last 20 units) with an Undo toast. Unusually large deletions
  (more than 10 units and more than half of everything synced) require explicit confirmation.
- **Oversized files are skipped** (`maxFileSizeMB`, default 50 — GitHub blobs cap at 100 MB).

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `agentSessionsSync.agents.<id>.enabled` | `true` | Toggle an agent (claude / codex / cursor) |
| `agentSessionsSync.agents.<id>.path` | *(agent default)* | Override the local sessions directory |
| `agentSessionsSync.autoSync` | `true` | Sync on startup / change / interval |
| `agentSessionsSync.pollIntervalMinutes` | `5` | Remote poll interval |
| `agentSessionsSync.debounceSeconds` | `30` | Wait after a local change before syncing |
| `agentSessionsSync.freshMinutes` | `5` | Skip files modified within this window (0 = off) |
| `agentSessionsSync.maxFileSizeMB` | `50` | Skip files larger than this |

## Privacy

Session transcripts contain your **full AI conversations** — code, prompts, and anything
you pasted into a chat. They are stored only in the GitHub repository **you** choose.
Use a private repository; the setup wizard warns you if you pick a public one.

## Limitations worth knowing

- **Claude Code project paths:** Claude Code names its per-project session folders after the
  project's absolute path. Synced sessions appear in `claude --resume` on another machine
  only when the project lives at the same path there. With different paths you still get a
  full backup — the transcripts just aren't listed for resume.
- **Deletions propagate.** When an agent cleans up old sessions locally (e.g. Claude Code's
  `cleanupPeriodDays`), the next sync mirrors that deletion to the repository and your other
  machines. The trash backup, the confirmation guard, and the repo's git history are your
  safety nets.

## Commands

- `Agent Sessions Sync: Set Up / Change Repository`
- `Agent Sessions Sync: Sync Now`
- `Agent Sessions Sync: Resolve Conflicts`
- `Agent Sessions Sync: Open Repository on GitHub`
- `Agent Sessions Sync: Show Log`
- `Agent Sessions Sync: Open Sync Menu`

## License

MIT
