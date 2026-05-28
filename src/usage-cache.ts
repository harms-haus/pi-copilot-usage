// Usage data caching with TTL cooldown

import type { CopilotUsageData } from "./api.js";

export const CACHE_TTL_MS = 60_000;

export class UsageCache {
  private data: CopilotUsageData | null = null;
  private fetchedAt = 0;
  private errorUntil = 0;

  get(): CopilotUsageData | null {
    if (this.data !== null && Date.now() - this.fetchedAt <= CACHE_TTL_MS) {
      return this.data;
    }
    return null;
  }

  set(data: CopilotUsageData): void {
    this.data = data;
    this.fetchedAt = Date.now();
  }

  clear(): void {
    this.data = null;
    this.fetchedAt = 0;
    this.errorUntil = 0;
  }

  isInBackoff(): boolean {
    return Date.now() < this.errorUntil;
  }

  setErrorBackoff(): void {
    this.errorUntil = Date.now() + CACHE_TTL_MS;
  }
}
