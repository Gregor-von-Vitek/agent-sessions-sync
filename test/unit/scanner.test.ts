import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitBlobSha, scanAgents } from '../../src/sync/scanner';
import { Agent } from '../../src/sync/types';
import { describeUnit, expandUserPath, isValidRepoPath, repoPathToLocal } from '../../src/util/paths';

function agent(id: string, repoDir: string, localPath: string): Agent {
  return { id, label: id, repoDir, localPath, unitDepth: 3 };
}

describe('gitBlobSha', () => {
  it('matches git hash-object for known vectors', () => {
    // git hash-object of an empty file
    expect(gitBlobSha(Buffer.from(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    // echo "hello" | git hash-object --stdin
    expect(gitBlobSha(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('scanAgents', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    while (tmpDirs.length) {
      await fs.rm(tmpDirs.pop()!, { recursive: true, force: true });
    }
  });

  async function mkTmp(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('returns an empty result for a missing directory', async () => {
    const result = await scanAgents([agent('claude', 'claude', path.join(os.tmpdir(), 'does-not-exist-xyz'))]);
    expect(result.files).toEqual({});
    expect(result.fresh.size).toBe(0);
    expect(result.oversized.size).toBe(0);
  });

  it('scans nested sessions, prefixes with the agent repoDir, skips junk and .git', async () => {
    const dir = await mkTmp();
    await fs.mkdir(path.join(dir, 'proj', 'sess1', 'subagents'), { recursive: true });
    await fs.writeFile(path.join(dir, 'proj', 'sess1.jsonl'), 'hello\n');
    await fs.writeFile(path.join(dir, 'proj', 'sess1', 'subagents', 'a1.jsonl'), 'print(1)\n');
    await fs.writeFile(path.join(dir, 'proj', '.DS_Store'), 'junk');
    await fs.writeFile(path.join(dir, 'proj', 'draft.tmp'), 'junk');
    await fs.mkdir(path.join(dir, '.git'));
    await fs.writeFile(path.join(dir, '.git', 'config'), 'junk');

    const result = await scanAgents([agent('claude', 'claude', dir)]);
    expect(Object.keys(result.files).sort()).toEqual([
      'claude/proj/sess1.jsonl',
      'claude/proj/sess1/subagents/a1.jsonl',
    ]);
    expect(result.files['claude/proj/sess1.jsonl']).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('merges multiple agents under distinct namespaces', async () => {
    const claudeDir = await mkTmp();
    const codexDir = await mkTmp();
    await fs.mkdir(path.join(claudeDir, 'proj'), { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'proj', 'sess.jsonl'), 'a\n');
    await fs.mkdir(path.join(codexDir, '2026', '07'), { recursive: true });
    await fs.writeFile(path.join(codexDir, '2026', '07', 'rollout-1.jsonl'), 'b\n');

    const result = await scanAgents([agent('claude', 'claude', claudeDir), agent('codex', 'codex', codexDir)]);
    expect(Object.keys(result.files).sort()).toEqual(['claude/proj/sess.jsonl', 'codex/2026/07/rollout-1.jsonl']);
  });

  it('marks recently modified files as fresh (still hashed)', async () => {
    const dir = await mkTmp();
    await fs.mkdir(path.join(dir, 'proj'), { recursive: true });
    const active = path.join(dir, 'proj', 'active.jsonl');
    const settled = path.join(dir, 'proj', 'settled.jsonl');
    await fs.writeFile(active, 'now\n');
    await fs.writeFile(settled, 'old\n');
    const old = new Date(Date.now() - 10 * 60_000);
    await fs.utimes(settled, old, old);

    const result = await scanAgents([agent('claude', 'claude', dir)], { freshMs: 60_000 });
    expect(result.fresh).toEqual(new Set(['claude/proj/active.jsonl']));
    expect(Object.keys(result.files).sort()).toEqual(['claude/proj/active.jsonl', 'claude/proj/settled.jsonl']);
  });

  it('freshMs of 0 disables the freshness check', async () => {
    const dir = await mkTmp();
    await fs.mkdir(path.join(dir, 'proj'), { recursive: true });
    await fs.writeFile(path.join(dir, 'proj', 'active.jsonl'), 'now\n');

    const result = await scanAgents([agent('claude', 'claude', dir)], { freshMs: 0 });
    expect(result.fresh.size).toBe(0);
  });

  it('skips oversized files entirely', async () => {
    const dir = await mkTmp();
    await fs.mkdir(path.join(dir, 'proj'), { recursive: true });
    await fs.writeFile(path.join(dir, 'proj', 'huge.jsonl'), 'x'.repeat(64));
    await fs.writeFile(path.join(dir, 'proj', 'small.jsonl'), 'ok\n');

    const result = await scanAgents([agent('claude', 'claude', dir)], { maxFileSize: 10 });
    expect(result.oversized).toEqual(new Set(['claude/proj/huge.jsonl']));
    expect(Object.keys(result.files)).toEqual(['claude/proj/small.jsonl']);
  });
});

describe('repo path safety', () => {
  const repoDirs = new Set(['claude', 'codex', 'cursor']);

  it('accepts normal session paths under a known agent namespace', () => {
    expect(isValidRepoPath(repoDirs, 'claude/proj/sess.jsonl')).toBe(true);
    expect(isValidRepoPath(repoDirs, 'codex/2026/07/15/rollout-1.jsonl')).toBe(true);
  });

  it('rejects paths outside a known namespace and traversal attempts', () => {
    expect(isValidRepoPath(repoDirs, 'README.md')).toBe(false);
    expect(isValidRepoPath(repoDirs, 'sessions/proj/sess.jsonl')).toBe(false); // unknown namespace
    expect(isValidRepoPath(repoDirs, 'claude/../evil')).toBe(false);
    expect(isValidRepoPath(repoDirs, 'claude/a/../../evil')).toBe(false);
    expect(isValidRepoPath(repoDirs, 'claude//x')).toBe(false);
    expect(isValidRepoPath(repoDirs, 'claude/a\\b')).toBe(false);
    expect(isValidRepoPath(repoDirs, 'claude/c:/x')).toBe(false);
  });

  it('maps repo paths into the owning agent dir and refuses unsafe ones', () => {
    const claudeDir = path.join(os.tmpdir(), 'claude-projects');
    const agents = [agent('claude', 'claude', claudeDir)];
    expect(repoPathToLocal(agents, 'claude/proj/sess.jsonl')).toBe(path.join(claudeDir, 'proj', 'sess.jsonl'));
    expect(repoPathToLocal(agents, 'claude/../evil')).toBeUndefined();
    expect(repoPathToLocal(agents, 'codex/proj/sess.jsonl')).toBeUndefined(); // unknown agent
  });

  it('describes a unit with its agent label', () => {
    const agents = [
      { id: 'claude', label: 'Claude Code', repoDir: 'claude', localPath: '/x', unitDepth: 3 },
      { id: 'codex', label: 'Codex', repoDir: 'codex', localPath: '/y', unitDepth: Number.POSITIVE_INFINITY },
    ];
    expect(describeUnit(agents, 'claude/proj/sess')).toBe('proj/sess (Claude Code)');
    expect(describeUnit(agents, 'codex/2026/07/15/rollout-1')).toBe('2026/07/15/rollout-1 (Codex)');
    expect(describeUnit(agents, 'unknown/alpha')).toBe('alpha (unknown)');
    expect(describeUnit(agents, 'claude')).toBe('claude');
  });

  it('expands ~ in user paths', () => {
    expect(expandUserPath('~/custom/projects')).toBe(path.join(os.homedir(), 'custom', 'projects'));
    expect(expandUserPath('~')).toBe(os.homedir());
  });
});
