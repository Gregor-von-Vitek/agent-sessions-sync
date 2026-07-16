# CLAUDE.md

Guidance for Claude Code when working in this repository. (User-facing docs live in
[README.md](README.md); keep development details here, not there.)

## What this is

**Agent Sessions Sync** — a VS Code extension that bidirectionally synchronizes multiple AI
agents' local session history (Claude Code `~/.claude/projects`, Codex `~/.codex/sessions`,
Cursor `~/.cursor/chats`) across machines through the user's own GitHub private repository.
No local git, no custom backend, zero runtime dependencies.

Sister project of **Agent Skills Sync** (`f:\-PROJECTS-\VSCode - Agent Skills Sync`), which
shares the same architecture; this repo generalizes the sync unit and adds session-specific
behavior (frozen active sessions, size cap, mass-delete guard).

## Commands

```bash
npm run build         # bundle src/extension.ts → dist/extension.js (esbuild)
npm run watch         # rebuild on change
npm run typecheck     # tsc --noEmit
npm test              # unit tests (vitest) — engine + scanner + paths
npm run test:integration   # activation smoke test in a real Extension Host (see gotchas)
npm run package       # produce agent-sessions-sync-<version>.vsix (vsce)
```

Press <kbd>F5</kbd> to launch the Extension Development Host.

## Multi-agent model

An **agent** (`src/sync/types.ts` → `Agent`) maps one local sessions directory to one top-level
**namespace** (`repoDir`) in the repository. Known agents and defaults live in
`src/config/agents.ts` (`KNOWN_AGENTS`): `claude`→`claude/`, `codex`→`codex/`, `cursor`→`cursor/`.
Each is toggled + repointed via settings `agentSessionsSync.agents.<id>.{enabled,path}`.

- The **sync/conflict unit is per-agent** (`Agent.unitDepth` + `unitOf(path, depth)` in
  `src/util/paths.ts`): the first `unitDepth` path segments; when the unit spans the whole
  path, the file extension is stripped so `claude/<proj>/<id>.jsonl` and
  `claude/<proj>/<id>/subagents/…` fold into one unit `claude/<proj>/<id>`.
  - claude: depth 3 (`claude/<project>/<session>`; `memory/` becomes `claude/<proj>/memory`)
  - codex: depth ∞ (one file = one session = one unit)
  - cursor: depth 2 (`cursor/<session>`)
- The engine receives `unitOf` as a parameter (`makeUnitOf(agents)`), it does not import a
  fixed one.
- A missing agent directory contributes nothing (scanner returns nothing for it).
- **Folder mapping** (`Agent.folderMap`, claude only): the `agents.claude.projectPaths`
  setting (machine-scoped: repo folder name → local project dir) renames an agent's
  *first-level* folders between the repo and local layouts, so a project living at different
  absolute paths per machine still syncs into the slug folder `claude --resume` reads.
  Built by `buildFolderMap` (`src/util/paths.ts`): local names case-normalized to on-disk
  casing; an entry stays **inactive while a local folder with the repo name exists** (else
  scan reads the old folder while downloads write the new one — worst case the engine would
  see mass local deletions). The `mapClaudeProject` command (`src/ui/projectMap.ts`) creates
  mappings and migrates the old folder away. Everything between the two boundaries
  (engine, BASE, conflicts, frozen sets) stays in repo-path space; translation happens only
  in the scanner (local→repo) and `repoPathToLocal`/`repoPathToLocalRel` (repo→local).

## Architecture

Data flows one direction per module; UI never touches GitHub directly.

- `src/sync/engine.ts` — **pure** 3-way diff
  (`computeSyncPlan(local, remote, base, unitOf, resolutions, frozen)`). No `vscode`/`node`
  imports → fully unit-tested. This is the heart; change it with tests.
- `src/sync/scanner.ts` — `scanAgents(agents, {freshMs, maxFileSize})` walks each agent dir →
  `{ files, fresh, oversized }`. Hash is the **git blob SHA-1** so it compares directly to
  GitHub tree shas. `fresh` = files modified within `freshMs` (still hashed); `oversized` =
  skipped entirely.
- `src/config/agents.ts` — builds the enabled `Agent[]` from settings (`getEnabledAgents`).
- `src/util/paths.ts` — `unitOf(path, depth)`, `makeUnitOf`, `localRelToRepoPath`,
  `repoPathToLocal(agents,…)`, `repoPathToLocalRel`, `isValidRepoPath(repoDirs,…)`,
  `describeUnit`, `expandUserPath`, `claudeProjectSlug`, `buildFolderMap`.
- `src/sync/stateStore.ts` — BASE (last-synced) state as JSON in `globalStorage`; keyed by
  repo+branch, never committed to the repo.
- `src/sync/trash.ts` — file-list based backup + Undo before local delete/overwrite
  (`backup(files: TrashFile[], label)`, restore into the agent root). Units may be a single
  file, file + sidecar dir, or a dir — hence file lists, not directories.
- `src/sync/controller.ts` — orchestrates one run: scan → freeze fresh/oversized units at
  BASE (both in the local map, for the no-op short-circuit, and via the engine's `frozen`
  set, which blocks downloads into an actively-written session) → fetch remote tree → plan →
  mass-delete guard → write local → commit (blobs→tree→commit→updateRef) → save BASE.
  Handles non-fast-forward retry, empty-repo init, conflict/deletion notifications.
- `src/sync/scheduler.ts` — startup sync, one file watcher per agent dir + debounce
  (default 30 s — sessions are written continuously), periodic poll, single-run queue.
- `src/github/{auth,client}.ts` — VS Code built-in GitHub auth (`repo` scope) +
  dependency-free REST client over global `fetch` (Git Data API).
- `src/ui/*` — status bar, setup wizard (warns on public repos — transcripts are sensitive),
  conflict resolution (native `vscode.diff`), quick menu, project-folder mapping
  (`projectMap.ts`: picks a repo folder via `controller.listRemoteFolders`, migrates the
  old local folder, writes the setting — in that order, so a mid-flow sync never sees a
  half-active mapping).
- `src/extension.ts` — activation (`onStartupFinished`), command registration, wiring.

## Invariants (do not break)

- **Never silently overwrite.** Same session changed on both sides → conflict, surfaced per
  unit. Conflicted units keep their BASE entries until resolved; other units keep syncing.
- **Frozen units are untouchable.** Fresh (`freshMinutes`) and oversized (`maxFileSizeMB`)
  files freeze their whole unit for the run: no upload, no download, no deletion, no
  conflict record, BASE preserved. Never write into a file an agent may be appending to.
- **Path safety:** every repo path is validated (`isValidRepoPath`) before being written to
  disk. Paths outside a known namespace (e.g. `README.md`) are ignored, not deleted.
- **BASE is local-only** and must stay consistent with what was actually pushed (use GitHub's
  returned blob shas, not the pre-scan shas).
- **Mass deletions ask first.** Removing >10 units and >50% of the synced units (either
  direction) requires modal confirmation (`confirmLargeDeletions`).

## Testing

- Unit tests cover the full decision table in `engine.ts` plus frozen-unit semantics and
  per-agent unit depths (`test/unit/engine.test.ts`), and the scanner (fresh/oversized) +
  hash + path-safety + folder mapping (slug vectors, `buildFolderMap` rules, mapped scans)
  (`test/unit/scanner.test.ts`). Add a table row or a mapping rule → add a test.
- `gitBlobSha` is verified against known `git hash-object` vectors.

## Windows gotchas (integration test)

`@vscode/test-electron` breaks on this repo's path because it has spaces and because the parent
process may export `ELECTRON_RUN_AS_NODE`. To run the integration test:

1. `ELECTRON_RUN_AS_NODE` must NOT be set (else the downloaded `Code.exe` runs as Node and
   rejects VS Code flags as "bad option"). Clear it in the shell.
2. The dev path passed to the runner must have no spaces — create a junction and pass it via
   `ASS_DEV_PATH` (honored by `test/integration/runTest.ts`):

```powershell
cmd /c mklink /J F:\asstest-sessions "F:\-PROJECTS-\VSCode - Agent Session Sync"
npm run build; npx tsc -p tsconfig.integration.json
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:ASS_DEV_PATH = "F:\asstest-sessions"
node F:\asstest-sessions\out-test\test\integration\runTest.js
```

These are environment/tooling constraints, not extension bugs.

## Packaging & publishing

- `npm run package` → VSIX. `.vscodeignore` keeps `src/`, tests, and `CLAUDE.md` out of the
  package.
- `publisher` in `package.json` must match a Marketplace publisher the user owns;
  `repository.url` should point at the real repo.
- Marketplace: publisher at marketplace.visualstudio.com/manage + an Azure DevOps PAT →
  `vsce publish`. Open VSX (Cursor/VSCodium): namespace matching `publisher`, then
  `ovsx publish <file> -p <token>`.

## Session-specific caveats / future work

- Claude Code project-slug dirs encode absolute project paths. Solved by the folder mapping
  above (`projectPaths` setting + Map Claude Project Folder command); without a mapping a
  differing path still degrades gracefully to a backup-only folder.
- Agents' own cleanup (e.g. Claude Code `cleanupPeriodDays`) propagates as deletions —
  guarded by trash + mass-delete confirmation + repo git history.
- The repo grows without bound (git history keeps every blob version). Possible future work:
  periodic history squash or a size warning.
