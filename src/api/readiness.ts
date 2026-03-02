// Simple readiness flag — health endpoint returns 503 until cache is warm
let ready = false;

export function isCacheReady(): boolean {
  return ready;
}

export function markCacheReady(): void {
  ready = true;
}
