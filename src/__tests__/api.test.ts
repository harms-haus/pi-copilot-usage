import { describe, it, expect, vi, beforeEach } from "vitest";
import { isCopilotProvider, fetchCopilotUsage } from "../api.js";
import type { CopilotUsageData } from "../api.js";

// Must mock node:child_process before any import that uses it
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

// Mock @earendil-works/pi-coding-agent so the import in api.ts resolves
vi.mock("@earendil-works/pi-coding-agent", () => ({}));

const COPILOT_USER_URL = "https://api.github.com/copilot_internal/user";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

function mockFetchResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

function createMockUserResponse(overrides: {
  percent_remaining: number;
  entitlement?: number;
  remaining?: number;
  quota_reset_date?: string;
}): Record<string, unknown> {
  return {
    copilot_plan: "business",
    quota_snapshots: {
      premium_interactions: {
        entitlement: overrides.entitlement ?? 300,
        remaining: overrides.remaining ?? 240,
        percent_remaining: overrides.percent_remaining,
      },
    },
    ...(overrides.quota_reset_date !== undefined
      ? { quota_reset_date: overrides.quota_reset_date }
      : {}),
  };
}

function createMockAuthStorage(options: { oauthRefresh?: string; accessToken?: string }) {
  return {
    get: vi
      .fn()
      .mockReturnValue(
        options.oauthRefresh
          ? { type: "oauth", refresh: options.oauthRefresh, access: "proxy-token" }
          : undefined,
      ),
    getApiKey: vi.fn().mockResolvedValue(options.accessToken),
  } as any;
}

describe("isCopilotProvider", () => {
  it('returns true for "github-copilot" (exact match)', () => {
    expect(isCopilotProvider("github-copilot")).toBe(true);
  });

  it('returns false for "openai"', () => {
    expect(isCopilotProvider("openai")).toBe(false);
  });

  it('returns false for "anthropic"', () => {
    expect(isCopilotProvider("anthropic")).toBe(false);
  });

  it('returns false for "zai"', () => {
    expect(isCopilotProvider("zai")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isCopilotProvider(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isCopilotProvider("")).toBe(false);
  });

  it('returns false for "GitHub-Copilot" (case-sensitive)', () => {
    expect(isCopilotProvider("GitHub-Copilot")).toBe(false);
  });

  it('returns false for "github-copilot-extra" (not prefix)', () => {
    expect(isCopilotProvider("github-copilot-extra")).toBe(false);
  });
});

describe("fetchCopilotUsage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("happy path", () => {
    it("Pro/Business tier: calculates percentage from percent_remaining and resetTimeMs from quota_reset_date", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse(
          createMockUserResponse({
            percent_remaining: 80,
            entitlement: 300,
            remaining: 240,
            quota_reset_date: "2025-07-01T00:00:00Z",
          }),
        ),
      );

      const authStorage = createMockAuthStorage({ oauthRefresh: "oauth-token" });
      const result: CopilotUsageData = await fetchCopilotUsage(authStorage);

      expect(result.percentage).toBe(20.0);
      expect(result.resetTimeMs).toBe(new Date("2025-07-01T00:00:00Z").getTime());
    });

    it("percentage rounding: percent_remaining 54.33 → percentage 45.7", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse(
          createMockUserResponse({
            percent_remaining: 54.33,
          }),
        ),
      );

      const authStorage = createMockAuthStorage({ oauthRefresh: "oauth-token" });
      const result: CopilotUsageData = await fetchCopilotUsage(authStorage);
      expect(result.percentage).toBe(45.7);
    });

    it("clamps negative: percent_remaining > 100 (105) → percentage 0", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse(
          createMockUserResponse({
            percent_remaining: 105,
          }),
        ),
      );

      const authStorage = createMockAuthStorage({ oauthRefresh: "oauth-token" });
      const result: CopilotUsageData = await fetchCopilotUsage(authStorage);
      expect(result.percentage).toBe(0);
    });

    it("clamps above 100: percent_remaining < 0 (-5) → percentage 100", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse(
          createMockUserResponse({
            percent_remaining: -5,
          }),
        ),
      );

      const authStorage = createMockAuthStorage({ oauthRefresh: "oauth-token" });
      const result: CopilotUsageData = await fetchCopilotUsage(authStorage);
      expect(result.percentage).toBe(100);
    });

    it("missing quota_reset_date → resetTimeMs should be undefined", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse(
          createMockUserResponse({
            percent_remaining: 50,
          }),
        ),
      );

      const authStorage = createMockAuthStorage({ oauthRefresh: "oauth-token" });
      const result: CopilotUsageData = await fetchCopilotUsage(authStorage);
      expect(result.percentage).toBe(50.0);
      expect(result.resetTimeMs).toBeUndefined();
    });
  });

  describe("error path", () => {
    it("throws when premium_interactions is missing from quota_snapshots", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse({
          quota_snapshots: {
            chat: { entitlement: 300, remaining: 150 },
          },
        }),
      );

      const authStorage = createMockAuthStorage({ oauthRefresh: "oauth-token" });
      await expect(fetchCopilotUsage(authStorage)).rejects.toThrow(
        "No premium_interactions quota found in GitHub Copilot usage response",
      );
    });

    it("throws when quota_snapshots is missing entirely", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse({
          copilot_plan: "business",
        }),
      );

      const authStorage = createMockAuthStorage({ oauthRefresh: "oauth-token" });
      await expect(fetchCopilotUsage(authStorage)).rejects.toThrow(
        "No premium_interactions quota found in GitHub Copilot usage response",
      );
    });

    it("throws when all auth strategies fail", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // All user URL calls return non-OK, token exchange returns a token but user URL still fails
      fetchSpy.mockImplementation((url: string | URL | Request) => {
        const urlStr =
          typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("/v2/token")) {
          return Promise.resolve(
            mockFetchResponse({ token: "exchanged-token", expires_at: 0, refresh_in: 0 }),
          );
        }
        return Promise.resolve(mockFetchResponse({}, false, 403));
      });

      // Mock gh CLI to return nothing useful
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, { stdout: "gh-token\n", stderr: "" });
        return {} as any;
      });

      const authStorage = createMockAuthStorage({
        oauthRefresh: "oauth-token",
        accessToken: "proxy-token",
      });
      await expect(fetchCopilotUsage(authStorage)).rejects.toThrow(
        "GitHub Copilot API request failed — all auth strategies exhausted",
      );
    });
  });

  describe("auth fallback", () => {
    it("OAuth Bearer succeeds on first try — only 1 fetch call to COPILOT_USER_URL", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValue(
        mockFetchResponse(
          createMockUserResponse({
            percent_remaining: 50,
            quota_reset_date: "2025-07-01T00:00:00Z",
          }),
        ),
      );

      const authStorage = createMockAuthStorage({ oauthRefresh: "oauth-token" });
      const result = await fetchCopilotUsage(authStorage);

      expect(result.percentage).toBe(50.0);
      // Only called once — the user URL, no token exchange needed
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        COPILOT_USER_URL,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer oauth-token",
          }),
        }),
      );
    });

    it("OAuth Bearer fails, OAuth token prefix succeeds — tries token prefix with same credential", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      let userCallCount = 0;
      fetchSpy.mockImplementation((url: string | URL | Request) => {
        const urlStr =
          typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("/v2/token")) {
          return Promise.resolve(
            mockFetchResponse({ token: "exchanged-token", expires_at: 0, refresh_in: 0 }),
          );
        }
        userCallCount++;
        if (userCallCount === 1) {
          // First call: Bearer with OAuth refresh — fails
          return Promise.resolve(mockFetchResponse({}, false, 401));
        }
        // Second call: token prefix with OAuth refresh — succeeds
        return Promise.resolve(
          mockFetchResponse(
            createMockUserResponse({
              percent_remaining: 60,
              quota_reset_date: "2025-08-01T00:00:00Z",
            }),
          ),
        );
      });

      const authStorage = createMockAuthStorage({ oauthRefresh: "oauth-refresh-token" });
      const result = await fetchCopilotUsage(authStorage);

      expect(result.percentage).toBe(40.0);
      // 2 user URL calls (Bearer fail, token prefix succeed)
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Verify both calls used the OAuth refresh token
      const userCalls = fetchSpy.mock.calls.filter((c) => {
        const calledUrl =
          typeof c[0] === "string" ? c[0] : c[0] instanceof URL ? c[0].toString() : c[0].url;
        return calledUrl === COPILOT_USER_URL;
      });
      expect(userCalls.length).toBe(2);
      expect(userCalls[0]![1]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer oauth-refresh-token",
          }),
        }),
      );
      expect(userCalls[1]![1]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "token oauth-refresh-token",
          }),
        }),
      );
    });

    it("OAuth fails, token exchange with proxy token succeeds — retries user URL with exchanged token", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      let userCallCount = 0;
      fetchSpy.mockImplementation((url: string | URL | Request) => {
        const urlStr =
          typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("/v2/token")) {
          // Token exchange succeeds
          return Promise.resolve(
            mockFetchResponse({ token: "exchanged-token", expires_at: 0, refresh_in: 0 }),
          );
        }
        userCallCount++;
        // All user URL calls before the exchanged token attempt fail
        if (userCallCount <= 2) {
          return Promise.resolve(mockFetchResponse({}, false, 401));
        }
        // Third user call (with exchanged token) succeeds
        return Promise.resolve(
          mockFetchResponse(
            createMockUserResponse({
              percent_remaining: 60,
              quota_reset_date: "2025-08-01T00:00:00Z",
            }),
          ),
        );
      });

      // gh CLI should not be called
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(new Error("should not be called"));
        return {} as any;
      });

      const authStorage = createMockAuthStorage({
        oauthRefresh: "oauth-token",
        accessToken: "proxy-token",
      });
      const result = await fetchCopilotUsage(authStorage);

      expect(result.percentage).toBe(40.0);

      // Verify the token exchange was called with proxy token
      expect(fetchSpy).toHaveBeenCalledWith(
        COPILOT_TOKEN_URL,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer proxy-token",
          }),
        }),
      );

      // Verify the retry used the exchanged token
      const userCalls = fetchSpy.mock.calls.filter((c) => {
        const calledUrl =
          typeof c[0] === "string" ? c[0] : c[0] instanceof URL ? c[0].toString() : c[0].url;
        return calledUrl === COPILOT_USER_URL;
      });
      expect(userCalls.length).toBe(3);
      // Third call should use exchanged token with Bearer
      expect(userCalls[2]![1]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer exchanged-token",
          }),
        }),
      );
    });

    it("OAuth and token exchange fail, proxy token direct with token prefix succeeds", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      let userCallCount = 0;
      fetchSpy.mockImplementation((url: string | URL | Request) => {
        const urlStr =
          typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("/v2/token")) {
          // Token exchange fails
          return Promise.resolve(mockFetchResponse({}, false, 401));
        }
        userCallCount++;
        // OAuth Bearer fails, OAuth token prefix fails, proxy direct succeeds
        if (userCallCount <= 2) {
          return Promise.resolve(mockFetchResponse({}, false, 401));
        }
        return Promise.resolve(
          mockFetchResponse(
            createMockUserResponse({
              percent_remaining: 75,
              quota_reset_date: "2025-09-01T00:00:00Z",
            }),
          ),
        );
      });

      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(new Error("should not be called"));
        return {} as any;
      });

      const authStorage = createMockAuthStorage({
        oauthRefresh: "oauth-token",
        accessToken: "proxy-token",
      });
      const result = await fetchCopilotUsage(authStorage);

      expect(result.percentage).toBe(25.0);
      expect(result.resetTimeMs).toBe(new Date("2025-09-01T00:00:00Z").getTime());
    });

    it("all other auth fails, gh CLI succeeds with token prefix", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      let userCallCount = 0;
      fetchSpy.mockImplementation((url: string | URL | Request) => {
        const urlStr =
          typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("/v2/token")) {
          return Promise.resolve(mockFetchResponse({}, false, 401));
        }
        userCallCount++;
        // All earlier calls fail, last call (gh CLI) succeeds
        if (userCallCount <= 1) {
          return Promise.resolve(mockFetchResponse({}, false, 401));
        }
        return Promise.resolve(
          mockFetchResponse(
            createMockUserResponse({
              percent_remaining: 75,
              quota_reset_date: "2025-09-01T00:00:00Z",
            }),
          ),
        );
      });

      // gh CLI returns a different token
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, { stdout: "gh-cli-token\n", stderr: "" });
        return {} as any;
      });

      const authStorage = createMockAuthStorage({ accessToken: "proxy-token" });
      const result = await fetchCopilotUsage(authStorage);

      expect(result.percentage).toBe(25.0);
      expect(result.resetTimeMs).toBe(new Date("2025-09-01T00:00:00Z").getTime());

      // Verify execFile was called with correct args
      expect(execFile).toHaveBeenCalledWith(
        "gh",
        ["auth", "token"],
        expect.objectContaining({ timeout: 5000 }),
        expect.any(Function),
      );
    });
  });

  describe("headers", () => {
    it("includes correct Copilot headers in fetch calls", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValue(
        mockFetchResponse(
          createMockUserResponse({
            percent_remaining: 50,
          }),
        ),
      );

      const authStorage = createMockAuthStorage({ oauthRefresh: "oauth-token" });
      await fetchCopilotUsage(authStorage);

      expect(fetchSpy).toHaveBeenCalledWith(
        COPILOT_USER_URL,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer oauth-token",
            Accept: "application/json",
            "User-Agent": "GitHubCopilotChat/0.35.0",
            "Editor-Version": "vscode/1.107.0",
            "Editor-Plugin-Version": "copilot-chat/0.35.0",
            "Copilot-Integration-Id": "vscode-chat",
            "Content-Type": "application/json",
          }),
        }),
      );
    });
  });
});
