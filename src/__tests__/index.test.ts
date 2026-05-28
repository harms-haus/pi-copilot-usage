import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetStatus = vi.fn();
const mockGetApiKey = vi.fn();
const mockFetchCopilotUsage = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheClear = vi.fn();
const mockIsInBackoff = vi.fn();
const mockSetErrorBackoff = vi.fn();

vi.mock("../api.js", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import("../api.js")>("../api.js");
  return {
    ...actual,
    fetchCopilotUsage: (...args: unknown[]) => mockFetchCopilotUsage(...args),
  };
});

vi.mock("../usage-cache.js", () => ({
  UsageCache: vi.fn().mockImplementation(function () {
    return {
      get: (...args: unknown[]) => mockCacheGet(...args),
      set: (...args: unknown[]) => mockCacheSet(...args),
      clear: (...args: unknown[]) => mockCacheClear(...args),
      isInBackoff: (...args: unknown[]) => mockIsInBackoff(...args),
      setErrorBackoff: (...args: unknown[]) => mockSetErrorBackoff(...args),
    };
  }),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({}));

const mockCtx = {
  hasUI: true,
  ui: { setStatus: mockSetStatus },
  model: { provider: "github-copilot", id: "gpt-4.1" },
  modelRegistry: { getApiKeyForProvider: mockGetApiKey },
};

const sampleUsageData = { percentage: 42.5, resetTimeMs: 1700000000000 };

async function getHandlers() {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const mockPi = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      handlers[event] = handler;
    },
  };

  const { default: initExtension } = await import("../index.js");
  initExtension(mockPi as never);
  return handlers;
}

describe("extension entry point", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetApiKey.mockResolvedValue("test-key");
    mockFetchCopilotUsage.mockResolvedValue(sampleUsageData);
    mockIsInBackoff.mockReturnValue(false);
  });

  // ── session_start ──────────────────────────────────────────────────

  describe("session_start handler", () => {
    it("fetches usage, caches, and publishes status when copilot model + hasUI + API key", async () => {
      const handlers = await getHandlers();

      await handlers["session_start"]!(undefined, mockCtx);

      expect(mockFetchCopilotUsage).toHaveBeenCalledWith("test-key");
      expect(mockCacheSet).toHaveBeenCalledWith(sampleUsageData);
      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", expect.any(String));

      const payload = JSON.parse(mockSetStatus.mock.calls[0]![1]);
      expect(payload).toEqual({
        percentage: sampleUsageData.percentage,
        resetTimeMs: sampleUsageData.resetTimeMs,
      });
    });

    it("silently skips when copilot model + hasUI but no API key", async () => {
      const handlers = await getHandlers();
      mockGetApiKey.mockResolvedValue(undefined);

      await handlers["session_start"]!(undefined, mockCtx);

      expect(mockFetchCopilotUsage).not.toHaveBeenCalled();
      expect(mockSetStatus).not.toHaveBeenCalled();
    });

    it("clears status when non-copilot model", async () => {
      const handlers = await getHandlers();
      const ctx = { ...mockCtx, model: { provider: "openai", id: "gpt-4" } };

      await handlers["session_start"]!(undefined, ctx);

      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", undefined);
      expect(mockFetchCopilotUsage).not.toHaveBeenCalled();
    });

    it("does not call setStatus when hasUI is false", async () => {
      const handlers = await getHandlers();
      const ctx = { ...mockCtx, hasUI: false };

      await handlers["session_start"]!(undefined, ctx);

      expect(mockSetStatus).not.toHaveBeenCalled();
    });

    it("logs error with [pi-copilot-usage] prefix and does not crash when fetchCopilotUsage throws", async () => {
      const handlers = await getHandlers();
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetchCopilotUsage.mockRejectedValue(new Error("network failure"));

      await handlers["session_start"]!(undefined, mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith("[pi-copilot-usage]", expect.any(Error));
      expect(mockSetStatus).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  // ── model_select ───────────────────────────────────────────────────

  describe("model_select handler", () => {
    it("clears cache and fetches fresh data when switching to copilot", async () => {
      const handlers = await getHandlers();

      await handlers["model_select"]!(undefined, mockCtx);

      expect(mockCacheClear).toHaveBeenCalled();
      expect(mockFetchCopilotUsage).toHaveBeenCalledWith("test-key");
      expect(mockCacheSet).toHaveBeenCalledWith(sampleUsageData);
      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", expect.any(String));
    });

    it("clears status when switching away from copilot", async () => {
      const handlers = await getHandlers();
      const ctx = { ...mockCtx, model: { provider: "openai", id: "gpt-4" } };

      await handlers["model_select"]!(undefined, ctx);

      expect(mockCacheClear).toHaveBeenCalled();
      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", undefined);
      expect(mockFetchCopilotUsage).not.toHaveBeenCalled();
    });
  });

  // ── turn_end ───────────────────────────────────────────────────────

  describe("turn_end handler", () => {
    it("uses cached data when cache is fresh and skips fetch", async () => {
      const handlers = await getHandlers();
      mockCacheGet.mockReturnValue(sampleUsageData);

      await handlers["turn_end"]!(undefined, mockCtx);

      expect(mockFetchCopilotUsage).not.toHaveBeenCalled();
      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", expect.any(String));

      const payload = JSON.parse(mockSetStatus.mock.calls[0]![1]);
      expect(payload).toEqual({
        percentage: sampleUsageData.percentage,
        resetTimeMs: sampleUsageData.resetTimeMs,
      });
    });

    it("fetches fresh data when cache is expired", async () => {
      const handlers = await getHandlers();
      mockCacheGet.mockReturnValue(null);

      await handlers["turn_end"]!(undefined, mockCtx);

      expect(mockFetchCopilotUsage).toHaveBeenCalledWith("test-key");
      expect(mockCacheSet).toHaveBeenCalledWith(sampleUsageData);
    });

    it("clears status when non-copilot model", async () => {
      const handlers = await getHandlers();
      const ctx = { ...mockCtx, model: { provider: "openai", id: "gpt-4" } };

      await handlers["turn_end"]!(undefined, ctx);

      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", undefined);
      expect(mockFetchCopilotUsage).not.toHaveBeenCalled();
    });
  });

  // ── in-flight guard ──────────────────────────────────────────────────

  describe("in-flight guard", () => {
    it("coalesces concurrent calls into one API fetch", async () => {
      const handlers = await getHandlers();

      mockFetchCopilotUsage.mockImplementation(() => {
        return new Promise((r) => {
          setTimeout(() => {
            r(sampleUsageData);
          }, 10);
        });
      });

      const [result1, result2] = await Promise.all([
        handlers["session_start"]!(undefined, mockCtx),
        handlers["session_start"]!(undefined, mockCtx),
      ]);

      expect(mockFetchCopilotUsage).toHaveBeenCalledTimes(1);
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
    });

    it("allows a second fetch after the first completes", async () => {
      const handlers = await getHandlers();

      await handlers["session_start"]!(undefined, mockCtx);
      await handlers["session_start"]!(undefined, mockCtx);

      expect(mockFetchCopilotUsage).toHaveBeenCalledTimes(2);
    });
  });

  // ── model_select cache clearing ─────────────────────────────────────

  describe("model_select cache clearing", () => {
    it("does not clear cache when switching between copilot models", async () => {
      const handlers = await getHandlers();

      // Initialize lastProvider with copilot
      await handlers["session_start"]!(undefined, mockCtx);
      mockCacheClear.mockClear();

      // model_select with same copilot provider should NOT clear cache
      await handlers["model_select"]!(undefined, mockCtx);

      expect(mockCacheClear).not.toHaveBeenCalled();
    });

    it("clears cache when switching from copilot to non-copilot provider", async () => {
      const handlers = await getHandlers();
      const openaiCtx = { ...mockCtx, model: { provider: "openai", id: "gpt-4" } };

      // Initialize lastProvider with copilot
      await handlers["session_start"]!(undefined, mockCtx);
      mockCacheClear.mockClear();

      // model_select with non-copilot provider should clear cache
      await handlers["model_select"]!(undefined, openaiCtx);

      expect(mockCacheClear).toHaveBeenCalled();
    });

    it("clears cache when switching from non-copilot to copilot provider", async () => {
      const handlers = await getHandlers();
      const openaiCtx = { ...mockCtx, model: { provider: "openai", id: "gpt-4" } };

      // Initialize lastProvider with non-copilot
      await handlers["session_start"]!(undefined, openaiCtx);
      mockCacheClear.mockClear();

      // model_select with copilot provider should clear cache
      await handlers["model_select"]!(undefined, mockCtx);

      expect(mockCacheClear).toHaveBeenCalled();
    });
  });

  // ── session_shutdown ───────────────────────────────────────────────

  describe("session_shutdown handler", () => {
    it("clears status via setStatus with undefined", async () => {
      const handlers = await getHandlers();

      handlers["session_shutdown"]!(undefined, mockCtx);

      expect(mockSetStatus).toHaveBeenCalledWith("zai-usage", undefined);
    });

    it("does not call setStatus when hasUI is false", async () => {
      const handlers = await getHandlers();
      const ctx = { ...mockCtx, hasUI: false };

      handlers["session_shutdown"]!(undefined, ctx);

      expect(mockSetStatus).not.toHaveBeenCalled();
    });
  });
});
