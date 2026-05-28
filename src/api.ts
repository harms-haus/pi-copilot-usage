// GitHub Copilot API interaction, response types, and provider detection

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CopilotUsageData {
  percentage: number;
  resetTimeMs?: number;
}

interface PremiumInteractions {
  entitlement: number;
  remaining: number;
  percent_remaining: number;
  overage_count?: number;
  overage_permitted?: boolean;
}

interface QuotaSnapshots {
  premium_interactions?: PremiumInteractions;
  chat?: { entitlement: number; remaining: number };
  completions?: { entitlement: number; remaining: number };
}

interface CopilotUserResponse {
  copilot_plan?: string;
  quota_reset_date?: string;
  quota_snapshots?: QuotaSnapshots;
  access_type_sku?: string;
  limited_user_reset_date?: string;
  monthly_quotas?: Record<string, number>;
  limited_user_quotas?: Record<string, number>;
}

interface TokenExchangeResponse {
  token: string;
  expires_at: number;
  refresh_in: number;
}

const COPILOT_USER_URL = "https://api.github.com/copilot_internal/user";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const REQUEST_TIMEOUT_MS = 10_000;
const GH_CLI_TIMEOUT_MS = 5_000;

const COPILOT_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
  "Content-Type": "application/json",
};

export function isCopilotProvider(provider: string | undefined): boolean {
  return provider === "github-copilot";
}

async function fetchWithToken(token: string): Promise<Response> {
  return fetch(COPILOT_USER_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...COPILOT_HEADERS,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function exchangeToken(githubToken: string): Promise<string | undefined> {
  try {
    const response: Response = await fetch(COPILOT_TOKEN_URL, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        ...COPILOT_HEADERS,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return undefined;
    }

    const json: TokenExchangeResponse = (await response.json()) as TokenExchangeResponse;
    return json.token;
  } catch {
    return undefined;
  }
}

async function getGhCliToken(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      timeout: GH_CLI_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function parseCopilotResponse(json: CopilotUserResponse): CopilotUsageData {
  const premium: PremiumInteractions | undefined = json.quota_snapshots?.premium_interactions;

  if (!premium) {
    throw new Error("No premium_interactions quota found in GitHub Copilot usage response");
  }

  const percentage: number = Math.max(
    0,
    Math.min(100, Math.round((100 - premium.percent_remaining) * 10) / 10),
  );

  const resetTimeMs: number | undefined = json.quota_reset_date
    ? new Date(json.quota_reset_date).getTime()
    : undefined;

  return { percentage, resetTimeMs };
}

export async function fetchCopilotUsage(apiKey: string): Promise<CopilotUsageData> {
  // Tier 1: Direct Bearer token attempt
  let response: Response = await fetchWithToken(apiKey);
  if (response.ok) {
    const json: CopilotUserResponse = (await response.json()) as CopilotUserResponse;
    return parseCopilotResponse(json);
  }
  await response.body?.cancel();

  // Tier 2: Token exchange
  const exchangedToken: string | undefined = await exchangeToken(apiKey);
  if (exchangedToken) {
    response = await fetchWithToken(exchangedToken);
    if (response.ok) {
      const json: CopilotUserResponse = (await response.json()) as CopilotUserResponse;
      return parseCopilotResponse(json);
    }
    await response.body?.cancel();
  }

  // Tier 3: gh CLI fallback
  const ghToken: string | undefined = await getGhCliToken();
  if (ghToken != null && ghToken !== apiKey) {
    response = await fetchWithToken(ghToken);
    if (response.ok) {
      const json: CopilotUserResponse = (await response.json()) as CopilotUserResponse;
      return parseCopilotResponse(json);
    }
    await response.body?.cancel();
  }

  throw new Error(`GitHub Copilot API request failed with status ${response.status}`);
}
