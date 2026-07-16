import { describe, expect, it } from 'vitest';
import { computeSyncPlan, countUnits, mapsEqual } from '../../src/sync/engine';
import { ConflictResolution, FileShaMap } from '../../src/sync/types';
import { makeUnitOf, unitOf } from '../../src/util/paths';

// Realistic sessions layout: claude units are <agent>/<project>/<session> (depth 3, extension
// stripped so a session file and its sidecar dir fold together), codex units are one file per
// session (depth ∞), cursor units are <agent>/<session> (depth 2).
const unit = makeUnitOf([
  { repoDir: 'claude', unitDepth: 3 },
  { repoDir: 'codex', unitDepth: Number.POSITIVE_INFINITY },
  { repoDir: 'cursor', unitDepth: 2 },
]);

const A = 'claude/proj/alpha.jsonl'; // unit claude/proj/alpha
const A2 = 'claude/proj/alpha/subagents/a1.jsonl'; // same unit as A
const B = 'claude/proj/beta.jsonl'; // unit claude/proj/beta
const CODEX = 'codex/2026/07/15/rollout-alpha.jsonl'; // its own unit

function res(entries: Record<string, ConflictResolution>): Map<string, ConflictResolution> {
  return new Map(Object.entries(entries));
}

function plan(
  local: FileShaMap,
  remote: FileShaMap,
  base: FileShaMap,
  resolutions?: Map<string, ConflictResolution>,
  frozen?: Set<string>
) {
  return computeSyncPlan(local, remote, base, unit, resolutions ?? new Map(), frozen ?? new Set());
}

describe('unitOf / makeUnitOf / countUnits / mapsEqual', () => {
  it('claude: session file, sidecar dir and memory fold to depth-3 units', () => {
    expect(unit('claude/proj/alpha.jsonl')).toBe('claude/proj/alpha');
    expect(unit('claude/proj/alpha/subagents/a1.jsonl')).toBe('claude/proj/alpha');
    expect(unit('claude/proj/memory/MEMORY.md')).toBe('claude/proj/memory');
    expect(unit('claude/proj/memory/notes/deep.md')).toBe('claude/proj/memory');
  });

  it('codex: every file is its own unit (extension stripped)', () => {
    expect(unit('codex/2026/07/15/rollout-alpha.jsonl')).toBe('codex/2026/07/15/rollout-alpha');
    expect(unit('codex/2026/07/15/rollout-beta.jsonl')).toBe('codex/2026/07/15/rollout-beta');
  });

  it('cursor: depth-2 units', () => {
    expect(unit('cursor/abc123/store.db')).toBe('cursor/abc123');
    expect(unit('cursor/abc123/sub/blob.bin')).toBe('cursor/abc123');
  });

  it('unknown namespace falls back to the full path', () => {
    expect(unit('skills/x/y.md')).toBe('skills/x/y');
  });

  it('strips the extension only when the unit spans the whole path, and keeps dotfile names', () => {
    expect(unitOf('claude/proj/alpha.jsonl', 3)).toBe('claude/proj/alpha');
    expect(unitOf('claude/proj.dir/alpha/x.md', 3)).toBe('claude/proj.dir/alpha');
    expect(unitOf('claude/proj/.hidden', 3)).toBe('claude/proj/.hidden');
    expect(unitOf('claude/loose.json', 3)).toBe('claude/loose');
  });

  it('counts distinct units across agents', () => {
    expect(countUnits({ [A]: '1', [A2]: '2', [B]: '3', [CODEX]: '4' }, unit)).toBe(3);
    expect(countUnits({}, unit)).toBe(0);
  });

  it('compares file maps', () => {
    expect(mapsEqual({ [A]: '1' }, { [A]: '1' })).toBe(true);
    expect(mapsEqual({ [A]: '1' }, { [A]: '2' })).toBe(false);
    expect(mapsEqual({ [A]: '1' }, {})).toBe(false);
  });
});

describe('computeSyncPlan — decision table', () => {
  it('no changes anywhere → empty plan, base preserved', () => {
    const p = plan({ [A]: '1' }, { [A]: '1' }, { [A]: '1' });
    expect(p.uploads).toEqual([]);
    expect(p.downloads).toEqual([]);
    expect(p.removeRemote).toEqual([]);
    expect(p.removeLocal).toEqual([]);
    expect(p.conflicts).toEqual([]);
    expect(p.skipped).toEqual([]);
    expect(p.newBaseFiles).toEqual({ [A]: '1' });
  });

  it('local added → upload', () => {
    const p = plan({ [A]: '1' }, {}, {});
    expect(p.uploads).toEqual([A]);
    expect(p.newBaseFiles).toEqual({ [A]: '1' });
  });

  it('local modified, remote unchanged → upload', () => {
    const p = plan({ [A]: '2' }, { [A]: '1' }, { [A]: '1' });
    expect(p.uploads).toEqual([A]);
    expect(p.newBaseFiles).toEqual({ [A]: '2' });
  });

  it('remote added → download', () => {
    const p = plan({}, { [A]: '1' }, {});
    expect(p.downloads).toEqual([A]);
    expect(p.newBaseFiles).toEqual({ [A]: '1' });
  });

  it('remote modified, local unchanged → download', () => {
    const p = plan({ [A]: '1' }, { [A]: '2' }, { [A]: '1' });
    expect(p.downloads).toEqual([A]);
    expect(p.newBaseFiles).toEqual({ [A]: '2' });
  });

  it('deleted locally, remote unchanged → delete remotely', () => {
    const p = plan({}, { [A]: '1' }, { [A]: '1' });
    expect(p.removeRemote).toEqual([A]);
    expect(p.newBaseFiles).toEqual({});
  });

  it('deleted remotely, local unchanged → delete locally', () => {
    const p = plan({ [A]: '1' }, {}, { [A]: '1' });
    expect(p.removeLocal).toEqual([A]);
    expect(p.newBaseFiles).toEqual({});
  });

  it('both modified with identical content → base update only', () => {
    const p = plan({ [A]: '2' }, { [A]: '2' }, { [A]: '1' });
    expect(p.baseUpdates).toEqual([A]);
    expect(p.uploads).toEqual([]);
    expect(p.downloads).toEqual([]);
    expect(p.newBaseFiles).toEqual({ [A]: '2' });
  });

  it('both added with identical content → base update only', () => {
    const p = plan({ [A]: '1' }, { [A]: '1' }, {});
    expect(p.baseUpdates).toEqual([A]);
    expect(p.newBaseFiles).toEqual({ [A]: '1' });
  });

  it('both deleted → nothing, base entry dropped', () => {
    const p = plan({}, {}, { [A]: '1' });
    expect(p.conflicts).toEqual([]);
    expect(p.removeLocal).toEqual([]);
    expect(p.removeRemote).toEqual([]);
    expect(p.newBaseFiles).toEqual({});
  });

  it('both modified differently → conflict, base entry kept', () => {
    const p = plan({ [A]: '2' }, { [A]: '3' }, { [A]: '1' });
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].unit).toBe('claude/proj/alpha');
    expect(p.conflicts[0].files).toEqual([{ path: A, localSha: '2', remoteSha: '3', baseSha: '1' }]);
    expect(p.newBaseFiles).toEqual({ [A]: '1' });
  });

  it('modified locally, deleted remotely → conflict', () => {
    const p = plan({ [A]: '2' }, {}, { [A]: '1' });
    expect(p.conflicts).toHaveLength(1);
    expect(p.removeLocal).toEqual([]);
  });

  it('deleted locally, modified remotely → conflict', () => {
    const p = plan({}, { [A]: '2' }, { [A]: '1' });
    expect(p.conflicts).toHaveLength(1);
    expect(p.removeRemote).toEqual([]);
  });

  it('both added differently → conflict', () => {
    const p = plan({ [A]: '1' }, { [A]: '2' }, {});
    expect(p.conflicts).toHaveLength(1);
  });
});

describe('computeSyncPlan — unit-level conflict aggregation', () => {
  it('pulls the whole session out of the action lists when any of its files conflict', () => {
    const local = { [A]: '2', [A2]: '9' }; // A conflicts, A2 (sidecar) would be a plain upload
    const remote = { [A]: '3', [A2]: '1' };
    const base = { [A]: '1', [A2]: '1' };
    const p = plan(local, remote, base);
    expect(p.uploads).toEqual([]);
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].unit).toBe('claude/proj/alpha');
    expect(p.conflicts[0].files.map((f) => f.path).sort()).toEqual([A2, A].sort());
    // base kept for the entire unit so the conflict persists until resolved
    expect(p.newBaseFiles).toEqual({ [A]: '1', [A2]: '1' });
  });

  it('other sessions keep syncing while one is conflicted', () => {
    const local = { [A]: '2', [B]: '5' };
    const remote = { [A]: '3', [B]: '4' };
    const base = { [A]: '1', [B]: '5' };
    const p = plan(local, remote, base);
    expect(p.conflicts.map((c) => c.unit)).toEqual(['claude/proj/alpha']);
    expect(p.downloads).toEqual([B]);
    expect(p.newBaseFiles[B]).toBe('4');
  });

  it('units under different agents never collide', () => {
    // claude/proj/alpha conflicts; the codex session is an independent plain upload
    const local = { [A]: '2', [CODEX]: '7' };
    const remote = { [A]: '3' };
    const base = { [A]: '1' };
    const p = plan(local, remote, base);
    expect(p.conflicts.map((c) => c.unit)).toEqual(['claude/proj/alpha']);
    expect(p.uploads).toEqual([CODEX]);
  });
});

describe('computeSyncPlan — conflict resolutions', () => {
  it("'local' forces uploads and remote deletions for the whole unit", () => {
    const local = { [A]: '2' };
    const remote = { [A]: '3', [A2]: '7' }; // A2 exists only remotely
    const base = { [A]: '1', [A2]: '7' };
    const p = plan(local, remote, base, res({ 'claude/proj/alpha': 'local' }));
    expect(p.conflicts).toEqual([]);
    expect(p.uploads).toEqual([A]);
    expect(p.removeRemote).toEqual([A2]);
    expect(p.newBaseFiles).toEqual({ [A]: '2' });
  });

  it("'remote' forces downloads and local deletions for the whole unit", () => {
    const local = { [A]: '2', [A2]: '9' }; // A2 exists only locally
    const remote = { [A]: '3' };
    const base = { [A]: '1' };
    const p = plan(local, remote, base, res({ 'claude/proj/alpha': 'remote' }));
    expect(p.conflicts).toEqual([]);
    expect(p.downloads).toEqual([A]);
    expect(p.removeLocal).toEqual([A2]);
    expect(p.newBaseFiles).toEqual({ [A]: '3' });
  });

  it('resolution with identical content on both sides just updates the base', () => {
    const p = plan({ [A]: '2' }, { [A]: '2' }, { [A]: '1' }, res({ 'claude/proj/alpha': 'local' }));
    expect(p.baseUpdates).toEqual([A]);
    expect(p.newBaseFiles).toEqual({ [A]: '2' });
  });
});

describe('computeSyncPlan — frozen units (active/oversized sessions)', () => {
  const FROZEN = new Set(['claude/proj/alpha']);

  it('locally changed but frozen → no upload, base kept, reported as skipped', () => {
    const p = plan({ [A]: '2' }, { [A]: '1' }, { [A]: '1' }, undefined, FROZEN);
    expect(p.uploads).toEqual([]);
    expect(p.skipped).toEqual(['claude/proj/alpha']);
    expect(p.newBaseFiles).toEqual({ [A]: '1' });
  });

  it('remote changed but frozen → no download into an actively-written session', () => {
    const p = plan({ [A]: '1' }, { [A]: '2' }, { [A]: '1' }, undefined, FROZEN);
    expect(p.downloads).toEqual([]);
    expect(p.skipped).toEqual(['claude/proj/alpha']);
    expect(p.newBaseFiles).toEqual({ [A]: '1' });
  });

  it('remote deleted but frozen → no local deletion', () => {
    const p = plan({ [A]: '1' }, {}, { [A]: '1' }, undefined, FROZEN);
    expect(p.removeLocal).toEqual([]);
    expect(p.skipped).toEqual(['claude/proj/alpha']);
  });

  it('new frozen file (not in base) → not uploaded, no base entry yet', () => {
    const p = plan({ [A]: '1' }, {}, {}, undefined, FROZEN);
    expect(p.uploads).toEqual([]);
    expect(p.newBaseFiles).toEqual({});
    expect(p.skipped).toEqual(['claude/proj/alpha']);
  });

  it('would-be conflict on a frozen unit produces no conflict record', () => {
    const p = plan({ [A]: '2' }, { [A]: '3' }, { [A]: '1' }, undefined, FROZEN);
    expect(p.conflicts).toEqual([]);
    expect(p.skipped).toEqual(['claude/proj/alpha']);
    expect(p.newBaseFiles).toEqual({ [A]: '1' });
  });

  it('freezing covers sidecar files of the same unit', () => {
    const p = plan({ [A]: '2', [A2]: '2' }, {}, { [A]: '1', [A2]: '1' }, undefined, FROZEN);
    expect(p.uploads).toEqual([]);
    expect(p.removeRemote).toEqual([]);
    expect(p.newBaseFiles).toEqual({ [A]: '1', [A2]: '1' });
  });

  it('frozen wins over an explicit resolution', () => {
    const p = plan({ [A]: '2' }, { [A]: '3' }, { [A]: '1' }, res({ 'claude/proj/alpha': 'local' }), FROZEN);
    expect(p.uploads).toEqual([]);
    expect(p.conflicts).toEqual([]);
    expect(p.newBaseFiles).toEqual({ [A]: '1' });
  });

  it('other units keep syncing while one is frozen', () => {
    const p = plan({ [A]: '2', [B]: '5' }, {}, { [A]: '1' }, undefined, FROZEN);
    expect(p.uploads).toEqual([B]);
    expect(p.skipped).toEqual(['claude/proj/alpha']);
  });

  it('a frozen unit with no pending change is not reported as skipped', () => {
    const p = plan({ [A]: '1', [B]: '2' }, { [A]: '1' }, { [A]: '1' }, undefined, FROZEN);
    expect(p.skipped).toEqual([]);
    expect(p.uploads).toEqual([B]);
  });
});
