import type Database from 'better-sqlite3';

/**
 * Apply performance-critical PRAGMAs. Idempotent — safe to call on every
 * `openDb()`. Values chosen for a single-user self-host running on a
 * desktop-class machine.
 */
export function applyPragmas(db: Database.Database): void {
  // Already set in openDb() but included here for symmetry / safety if a
  // test creates its own Database handle.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  // 64 MB page cache (negative = KB).
  db.pragma('cache_size = -65536');
  // 256 MB mmap for read-heavy admin pages. Best-effort — on :memory: this
  // is a no-op; on real file DBs it lets the OS page cache serve reads.
  try {
    db.pragma('mmap_size = 268435456');
  } catch {
    // mmap can fail on some platforms (e.g. read-only filesystems); ignore.
  }
  // GROUP BY / ORDER BY spill to RAM.
  db.pragma('temp_store = MEMORY');
  // Run ANALYZE so the query planner has stats.
  db.pragma('optimize');
}
