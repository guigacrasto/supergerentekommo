// Simple readiness flag — health endpoint returns 503 until cache is warm
let ready = false;

export function isCacheReady(): boolean {
  return ready;
}

export function markCacheReady(): void {
  ready = true;
}

// Token status registry — updated by the scheduler, read by health endpoint
export interface TokenStatusEntry {
  label: string;
  status: "valid" | "expiring" | "expired" | "unknown";
  expiresAt?: number; // Unix timestamp (seconds)
  hoursLeft?: number;
}

let tokenStatuses: TokenStatusEntry[] = [];

export function setTokenStatuses(statuses: TokenStatusEntry[]): void {
  tokenStatuses = statuses;
}

export function getTokenStatuses(): TokenStatusEntry[] {
  return tokenStatuses;
}
