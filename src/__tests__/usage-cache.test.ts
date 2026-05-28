import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UsageCache } from "../usage-cache.js";
import type { CopilotUsageData } from "../api.js";

describe("UsageCache", () => {
  let cache: UsageCache;

  beforeEach(() => {
    cache = new UsageCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns data immediately after set", () => {
    const data: CopilotUsageData = { percentage: 50, resetTimeMs: 123 };
    cache.set(data);
    expect(cache.get()).toEqual(data);
  });

  it("returns null when cache is expired after 61 seconds", () => {
    vi.useFakeTimers();
    const data: CopilotUsageData = { percentage: 50, resetTimeMs: 123 };
    cache.set(data);
    vi.advanceTimersByTime(61_000);
    expect(cache.get()).toBeNull();
  });

  it("returns data at exact TTL boundary (60000ms)", () => {
    vi.useFakeTimers();
    const data: CopilotUsageData = { percentage: 50, resetTimeMs: 123 };
    cache.set(data);
    vi.advanceTimersByTime(60_000);
    expect(cache.get()).toEqual(data);
  });

  it("returns null just past TTL boundary (60001ms)", () => {
    vi.useFakeTimers();
    const data: CopilotUsageData = { percentage: 50, resetTimeMs: 123 };
    cache.set(data);
    vi.advanceTimersByTime(60_001);
    expect(cache.get()).toBeNull();
  });

  it("returns null on a fresh cache without any set", () => {
    expect(cache.get()).toBeNull();
  });

  it("returns null after clear", () => {
    const data: CopilotUsageData = { percentage: 50, resetTimeMs: 123 };
    cache.set(data);
    cache.clear();
    expect(cache.get()).toBeNull();
  });

  it("returns the most recent data after overwrite", () => {
    const data1: CopilotUsageData = { percentage: 10, resetTimeMs: 100 };
    const data2: CopilotUsageData = { percentage: 90, resetTimeMs: 200 };
    cache.set(data1);
    cache.set(data2);
    expect(cache.get()).toEqual(data2);
  });
});
