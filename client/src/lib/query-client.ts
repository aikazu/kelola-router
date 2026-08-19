import { QueryClient } from '@tanstack/react-query';

/**
 * Default staleTime is 30s — most admin pages don't change every 5s. Pages
 * that need fresher data (overview live counters) override per-query.
 *
 * `gcTime` 5 min: keep cached data on route changes so back-nav is instant.
 */
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_GC_MS = 5 * 60_000;

/** Use for slowly-changing reference data: models, accounts, aliases, transports. */
export const CATALOG_STALE_MS = 5 * 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_MS,
      gcTime: DEFAULT_GC_MS,
      refetchOnWindowFocus: false,
      retry: (failureCount, error: unknown) => {
        if (
          error instanceof Error &&
          'status' in error &&
          typeof (error as { status: unknown }).status === 'number'
        ) {
          const status = (error as { status: number }).status;
          if (status === 401 || status === 403 || status === 404) return false;
        }
        return failureCount < 2;
      },
    },
  },
});
