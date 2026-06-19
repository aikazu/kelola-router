// Tiny module to break a circular import: src/db/repos/requestLogs.ts -> src/api/admin/cache.ts.
// The cache module owns its private state; this file just re-exports the invalidation hook.
export { bumpAdminCacheVersion } from '../api/admin/cache.js';
