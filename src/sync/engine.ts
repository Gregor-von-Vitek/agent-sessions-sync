import { UnitFn } from '../util/paths';
import { ConflictFile, ConflictResolution, FileShaMap, SyncPlan } from './types';

/** Distinct sync units present in a file map. */
export function countUnits(files: FileShaMap, unitOf: UnitFn): number {
  return new Set(Object.keys(files).map(unitOf)).size;
}

export function mapsEqual(a: FileShaMap, b: FileShaMap): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  return aKeys.every((k) => a[k] === b[k]);
}

type Action = 'none' | 'upload' | 'removeRemote' | 'download' | 'removeLocal' | 'baseUpdate' | 'conflict';

/**
 * Three-way (LOCAL / REMOTE / BASE) state comparison producing a sync plan.
 *
 * Per path: a side "changed" when its sha differs from BASE (including add/remove).
 * - only local changed  → upload / removeRemote
 * - only remote changed → download / removeLocal
 * - both changed, same content → just update BASE
 * - both changed, different    → conflict, aggregated per unit (`unitOf`)
 *
 * A conflicted unit is synced atomically: all of its paths are pulled out of the
 * action lists and its BASE entries are kept, so the conflict persists across runs
 * until resolved. `resolutions` overrides the outcome for whole units.
 *
 * Units in `frozen` (sessions being actively written, oversized files) are left completely
 * untouched this run — no actions in either direction, no conflict records, BASE entries
 * kept — and reported in `plan.skipped` when they would otherwise have produced an action.
 */
export function computeSyncPlan(
  local: FileShaMap,
  remote: FileShaMap,
  base: FileShaMap,
  unitOf: UnitFn,
  resolutions: ReadonlyMap<string, ConflictResolution> = new Map(),
  frozen: ReadonlySet<string> = new Set()
): SyncPlan {
  const paths = [...new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])].sort();
  const actions = new Map<string, Action>();

  for (const p of paths) {
    const l: string | undefined = local[p];
    const r: string | undefined = remote[p];
    const b: string | undefined = base[p];
    const resolution = resolutions.get(unitOf(p));
    actions.set(p, resolution ? resolvedAction(l, r, b, resolution) : classify(l, r, b));
  }

  const conflictedUnits = new Set<string>();
  for (const [p, action] of actions) {
    if (action === 'conflict' && !frozen.has(unitOf(p))) {
      conflictedUnits.add(unitOf(p));
    }
  }

  const plan: SyncPlan = {
    uploads: [],
    removeRemote: [],
    downloads: [],
    removeLocal: [],
    baseUpdates: [],
    conflicts: [],
    skipped: [],
    newBaseFiles: {},
  };
  const conflictFiles = new Map<string, ConflictFile[]>();
  const skippedUnits = new Set<string>();

  for (const p of paths) {
    const l: string | undefined = local[p];
    const r: string | undefined = remote[p];
    const b: string | undefined = base[p];
    const unit = unitOf(p);

    if (frozen.has(unit)) {
      if (actions.get(p) !== 'none') {
        skippedUnits.add(unit);
      }
      if (b !== undefined) {
        plan.newBaseFiles[p] = b;
      }
      continue;
    }

    if (conflictedUnits.has(unit)) {
      let files = conflictFiles.get(unit);
      if (!files) {
        files = [];
        conflictFiles.set(unit, files);
      }
      files.push({ path: p, localSha: l, remoteSha: r, baseSha: b });
      if (b !== undefined) {
        plan.newBaseFiles[p] = b;
      }
      continue;
    }

    switch (actions.get(p)!) {
      case 'none':
        if (l !== undefined) {
          plan.newBaseFiles[p] = l;
        }
        break;
      case 'upload':
        plan.uploads.push(p);
        plan.newBaseFiles[p] = l!;
        break;
      case 'download':
        plan.downloads.push(p);
        plan.newBaseFiles[p] = r!;
        break;
      case 'removeRemote':
        plan.removeRemote.push(p);
        break;
      case 'removeLocal':
        plan.removeLocal.push(p);
        break;
      case 'baseUpdate':
        plan.baseUpdates.push(p);
        plan.newBaseFiles[p] = l!;
        break;
      case 'conflict':
        break;
    }
  }

  for (const unit of [...conflictFiles.keys()].sort()) {
    plan.conflicts.push({ unit, files: conflictFiles.get(unit)! });
  }
  plan.skipped = [...skippedUnits].sort();
  return plan;
}

function classify(l: string | undefined, r: string | undefined, b: string | undefined): Action {
  const localChanged = l !== b;
  const remoteChanged = r !== b;
  if (!localChanged && !remoteChanged) {
    return 'none';
  }
  if (localChanged && !remoteChanged) {
    return l === undefined ? (r !== undefined ? 'removeRemote' : 'none') : 'upload';
  }
  if (!localChanged && remoteChanged) {
    return r === undefined ? (l !== undefined ? 'removeLocal' : 'none') : 'download';
  }
  // both changed
  if (l === r) {
    return l === undefined ? 'none' : 'baseUpdate';
  }
  return 'conflict';
}

/** Outcome for a path whose unit has an explicit conflict resolution: force one side to win. */
function resolvedAction(
  l: string | undefined,
  r: string | undefined,
  b: string | undefined,
  resolution: ConflictResolution
): Action {
  if (resolution === 'local') {
    if (l === undefined) {
      return r === undefined ? 'none' : 'removeRemote';
    }
    if (l === r) {
      return b === l ? 'none' : 'baseUpdate';
    }
    return 'upload';
  }
  if (r === undefined) {
    return l === undefined ? 'none' : 'removeLocal';
  }
  if (r === l) {
    return b === r ? 'none' : 'baseUpdate';
  }
  return 'download';
}
