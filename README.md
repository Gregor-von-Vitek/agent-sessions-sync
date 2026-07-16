# Agent Sessions Sync

**Keep your AI agents' conversation history on every computer you use — automatically.**

---

## What is this?

If you use AI coding agents like **Claude Code**, **Codex**, or **Cursor**, every conversation
you have with them is saved on your computer — for example in `~/.claude/projects`. That
history is valuable: you resume yesterday's session, look up what the agent did last week, or
continue a long-running task exactly where you left off.

The problem starts the moment you switch machines:

```
   Your PC at work                     Your laptop at home
   ─────────────────────               ─────────────────────
   api-refactor (118 messages)         ❌ missing
   yesterday's debugging session       ❌ missing
   "continue where we left off"        ❌ can't — it's on the other machine
```

**Agent Sessions Sync fixes this.** Install it on each of your computers, connect it once to a
private GitHub repository you own, and from then on your sessions follow you everywhere —
quietly, in the background.

> Think of it as **chat history sync for your AI agents** — like your browser syncs tabs and
> history between devices, but for your agent conversations.

## What it does

- 📥 **Downloads** sessions from your other machines when you open VS Code.
- 📤 **Uploads** new and changed sessions on their own, shortly after a conversation settles.
- ✋ **Never disturbs a running conversation** — files an agent is actively writing are left
  completely alone until they've been quiet for a few minutes.
- 🔀 **Handles conflicts safely** when the same session changed on two machines — it shows you
  both versions instead of silently overwriting one.
- 🗑️ **Syncs deletions carefully** — a removed session is kept as a local backup with an
  **Undo** button, and your full history always stays in your GitHub repository.
- 🧭 **Shows its status** in the VS Code status bar at all times.

## Which agents are supported

Out of the box it can sync the session history of:

| Agent | Default folder |
| --- | --- |
| **Claude Code** | `~/.claude/projects` |
| **Codex** | `~/.codex/sessions` |
| **Cursor** | `~/.cursor/chats` |

All three are on by default, but an agent whose folder doesn't exist is simply skipped — so if
you only use Claude Code, nothing else gets in the way. You can turn each agent on or off and
point it at a custom folder in the settings.

---

## Getting started

### Your first computer

1. Install the extension. You'll see **Sessions: Set Up** in the status bar (bottom-right).
2. Click it (or run the command **Agent Sessions Sync: Set Up / Change Repository**).
3. **Sign in with GitHub** when prompted.
4. Choose where your sessions should live:
   - **Create a new private repository** (recommended — e.g. `my-agent-sessions`), or
   - pick an existing repository of yours.
5. Pick a branch (usually `main`).
6. Confirm the upload when it asks *"N local sessions found — upload them?"*.

That's it. Your conversation history is now safely stored in your own private GitHub
repository.

### Your next computer

1. Install the extension there too and start the same setup.
2. Sign in with the **same GitHub account** and pick the **same repository**.
3. When it says *"N sessions available remotely — download now?"*, confirm.

Within a few minutes both machines have the same history — and they'll stay that way.

> **The 5-minute promise:** install on two computers and have your conversations on both, in
> about five minutes, with no Git commands and no manual copying.

---

## Resuming a conversation on another machine (Claude Code)

`claude --resume` lists the conversations that belong to the project folder you're in — and
Claude Code files them under the project's **location on disk**. So:

- If a project lives at the **same path** on both machines (say `~/code/api` here and there),
  synced sessions show up in `claude --resume` right away. Nothing to do.
- If the paths **differ** (say `C:\work\api` at work but `~/code/api` at home), run
  **Agent Sessions Sync: Map Claude Project Folder** on the second machine. Pick the project
  as it appears in the repository, then point it at the project's folder on this machine —
  done. From then on that project's sessions land where `claude --resume` looks for them, and
  any sessions already downloaded are moved over automatically.

The same command helps if you move a project to a new folder on a single machine and want its
history to follow.

---

## How it works

You never have to think about any of this — but here's what's happening behind the scenes, in
case you're curious.

### Everything lives in *your* repository

The extension doesn't have a server or cloud of its own. Your sessions are stored in the
private GitHub repository **you** chose, organized by agent:

```
my-agent-sessions/
├── README.md
├── claude/
│   └── C--work-api/                  ← one folder per project
│       ├── 1a2b3c….jsonl             ← one conversation
│       └── memory/
├── codex/
│   └── 2026/07/16/rollout-….jsonl
└── cursor/
    └── 4d5e6f…/
```

You own the data completely. You can browse it on github.com, and every change is an ordinary
commit, so nothing is ever truly lost. You don't need to know anything about Git to use the
extension — GitHub is just the reliable, private place your history is kept.

### Smart, safe synchronization

The extension compares three things for every session:

- **your machine** (what's on this computer now),
- **the repository** (what's on GitHub),
- **the last synced state** (what was identical the last time it synced).

Comparing all three — rather than just "which file is newer" — lets it tell the difference
between *"I changed this"*, *"the other machine changed this"*, and *"we both changed this"*:

| What happened | What the extension does |
| --- | --- |
| You had a conversation | Uploads it |
| Another machine had a conversation | Downloads it |
| You deleted a session | Removes it from the repository |
| Another machine deleted a session | Removes it locally (keeps a backup + Undo) |
| Both machines made the **same** change | Nothing to do |
| Both machines changed the **same session differently** | Flags a **conflict** for you to resolve |

### Running conversations are left alone

Agents write to a session file continuously while you chat. The extension therefore treats any
file modified in the last few minutes (`freshMinutes`, default 5) as *in use*: it isn't
uploaded, downloaded, or deleted — in either direction — until the conversation has settled.
Your running session is never disturbed, and you don't get a commit per message.

### Conflicts are never resolved behind your back

If the same session somehow changed differently on two computers, the extension will **not**
guess. It marks that session as conflicted (the status bar turns to ⚠ **Session Conflict**)
and lets you decide, session by session:

- **Compare versions** — opens VS Code's normal side-by-side diff,
- **Keep local** — your version wins and is uploaded,
- **Use remote** — the repository's version wins (your local copy is backed up first).

Meanwhile, every *other* session keeps syncing normally. Only the one in question waits for
you.

### When sessions are deleted

Deletions sync too, but gently. If a session was removed on another machine — including when an
agent cleans up its own old history — this machine removes it as well, but first it tucks a
copy into a local backup and shows you an **Undo** button. An unusually large deletion (more
than 10 sessions and more than half of everything synced) always asks for confirmation first.
And because everything is in your Git history, you can recover older versions from GitHub.

### Very large sessions

Files larger than `maxFileSizeMB` (default 50 — GitHub stores files up to 100 MB) are skipped
and simply stay local.

### The status bar

The little indicator in the bottom-right tells you where things stand at a glance:

| Indicator | Meaning |
| --- | --- |
| ✓ **Sessions Synced** | Everything is up to date |
| ↻ **Syncing Sessions** | A sync is in progress |
| ⚠ **Session Conflict** | Something needs your decision — click to resolve |
| ✕ **Session Sync Error** | Something went wrong — click for details |
| **Sessions: Set Up** | Not connected yet — click to start |

Click it any time for a quick menu: sync now, resolve conflicts, map a project folder, open
your repository on GitHub, or view the log.

---

## Settings

Open **Settings** and search for *Agent Sessions Sync*, or click **Settings** in the
status-bar menu.

| Setting | Default | What it does |
| --- | --- | --- |
| `agentSessionsSync.agents.claude.enabled` | `true` | Sync Claude Code sessions |
| `agentSessionsSync.agents.claude.path` | `~/.claude/projects` | Where Claude Code sessions live |
| `agentSessionsSync.agents.claude.projectPaths` | `{}` | Where repository projects live on *this* machine (set by **Map Claude Project Folder**) |
| `agentSessionsSync.agents.codex.enabled` | `true` | Sync Codex sessions |
| `agentSessionsSync.agents.codex.path` | `~/.codex/sessions` | Where Codex sessions live |
| `agentSessionsSync.agents.cursor.enabled` | `true` | Sync Cursor sessions |
| `agentSessionsSync.agents.cursor.path` | `~/.cursor/chats` | Where Cursor sessions live |
| `agentSessionsSync.autoSync` | `true` | Sync automatically in the background |
| `agentSessionsSync.pollIntervalMinutes` | `5` | How often to check for changes from other machines |
| `agentSessionsSync.debounceSeconds` | `30` | How long to wait after a change before uploading |
| `agentSessionsSync.freshMinutes` | `5` | How long a session must be quiet before it syncs (0 = off) |
| `agentSessionsSync.maxFileSizeMB` | `50` | Skip session files larger than this |

Leave a path empty to use its default. Paths support `~` for your home folder.

## Commands

Open the Command Palette (`Ctrl`/`Cmd` + `Shift` + `P`) and type *Agent Sessions Sync*:

- **Set Up / Change Repository** — connect GitHub or switch repositories
- **Sync Now** — sync immediately
- **Resolve Conflicts** — review and resolve conflicting sessions
- **Map Claude Project Folder** — make another machine's sessions appear in `claude --resume` here
- **Open Repository on GitHub** — view your history online
- **Show Log** — see what the extension has been doing

---

## Your data & privacy

- Session transcripts contain your **full conversations** — code, prompts, file contents, and
  anything you pasted into a chat. They are stored **only** in the GitHub repository you
  choose; the extension has no backend and sends your files nowhere else.
- **Use a private repository.** The setup wizard warns you if you pick a public one.
- Sign-in uses VS Code's built-in GitHub account — no separate app to authorize, and the
  extension never sees or stores your password.
- Everything the extension does is an ordinary Git commit in your repository, so your full
  history is always yours to inspect or restore.

## What this version doesn't do (yet)

To keep it simple and dependable, this release deliberately leaves out: shrinking the
repository over time (Git keeps every version, so it only grows), storage other than GitHub,
and agents beyond the three above. If an agent cleans up its own old sessions (e.g. Claude
Code's `cleanupPeriodDays`), that cleanup syncs like any other deletion — the backups,
the confirmation guard, and your Git history are the safety nets.

## Requirements

- VS Code 1.90 or newer, on **Windows** or **macOS** (Linux is expected to work too).
- A GitHub account (a free account is fine — private repositories are included).

---

*Sister extension: [Agent Skills Sync](https://github.com/Gregor-von-Vitek/agent-skills-sync)
— the same idea for your agents' skills.*

*Questions or ideas? Open an issue in the repository linked on this extension's page.*
