# Changelog

## 0.2.0

- **Claude Code project folder mapping** — sessions synced from a machine where the project
  lives at a different absolute path can now show up in `claude --resume`. New command
  **Map Claude Project Folder** picks a project folder from the repository, points it at the
  project's directory on this machine, and moves already-downloaded sessions into place.
  Backed by the new per-machine setting `agentSessionsSync.agents.claude.projectPaths`.
- The status-bar quick menu gained a "Map Claude Project Folder…" entry.
- README rewritten as a user-facing guide.

## 0.1.0

Initial release.

- Bidirectional sync of AI agent session history via the user's own GitHub repository
  (Claude Code `~/.claude/projects`, Codex `~/.codex/sessions`, Cursor `~/.cursor/chats`).
- 3-way merge (local / remote / last-synced BASE) with per-session conflict resolution
  (Compare / Keep Local / Use Remote) in VS Code's native diff editor.
- Active sessions (modified within `freshMinutes`) and oversized files (`maxFileSizeMB`)
  are skipped in both directions until they settle.
- Local trash backup + Undo before deletions/overwrites; confirmation guard for unusually
  large deletions.
- Setup wizard with GitHub sign-in (VS Code built-in auth), private-repo creation, and a
  warning when a public repository is selected.
- Status bar item, quick menu, log channel, automatic sync (startup / watcher / poll).
