import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const KEEP_BACKUPS = 20;

/** One local file to back up. `relPath` is forward-slash, relative to the agent's local root. */
export interface TrashFile {
  absPath: string;
  relPath: string;
}

/**
 * Local safety net: before a unit's local files are deleted or overwritten (remote deletion
 * propagated to this machine, or "Use Remote" conflict resolution), they are copied here.
 * A unit may be a single session file, a file plus its sidecar directory, or a whole directory —
 * so backups work on explicit file lists rather than assuming a directory.
 */
export class Trash {
  constructor(
    private readonly trashDir: string,
    private readonly log: { info(msg: string): void; warn(msg: string): void }
  ) {}

  /** Copy the unit's files into the trash, preserving their relative layout. Returns the backup path, or undefined when nothing exists to back up. */
  async backup(files: readonly TrashFile[], label: string): Promise<string | undefined> {
    const existing: TrashFile[] = [];
    for (const file of files) {
      try {
        const stat = await fs.stat(file.absPath);
        if (stat.isFile()) {
          existing.push(file);
        }
      } catch {
        // missing — nothing to back up for this entry
      }
    }
    if (existing.length === 0) {
      return undefined;
    }
    const safeLabel = label.replace(/[^A-Za-z0-9._-]+/g, '_');
    const backupPath = path.join(this.trashDir, `${Date.now()}-${safeLabel}`);
    for (const file of existing) {
      const target = path.join(backupPath, ...file.relPath.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(file.absPath, target);
    }
    this.log.info(`Backed up ${existing.length} file(s) of ${label} to ${backupPath}`);
    await this.prune();
    return backupPath;
  }

  /** Restore a backup into the agent's local root (overwrites existing files). */
  async restore(backupPath: string, targetRoot: string): Promise<void> {
    await fs.cp(backupPath, targetRoot, { recursive: true });
    this.log.info(`Restored ${targetRoot} from ${backupPath}`);
  }

  private async prune(): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(this.trashDir, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort(); // names start with a timestamp → lexicographic sort is chronological
    const excess = dirs.length - KEEP_BACKUPS;
    for (let i = 0; i < excess; i++) {
      try {
        await fs.rm(path.join(this.trashDir, dirs[i]), { recursive: true, force: true });
      } catch (e) {
        this.log.warn(`Failed to prune trash entry ${dirs[i]}: ${String(e)}`);
      }
    }
  }
}
