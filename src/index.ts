// Copilot usage monitor extension entry point

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fetchCopilotUsage, isCopilotProvider } from "./api.js";
import type { CopilotUsageData } from "./api.js";
import { UsageCache } from "./usage-cache.js";

const cache = new UsageCache();
let refreshPromise: Promise<void> | null = null;
let lastProvider: string | undefined = undefined;

async function refreshUsage(ctx: ExtensionContext): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh(ctx).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function doRefresh(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  if (!isCopilotProvider(ctx.model?.provider)) {
    ctx.ui.setStatus("zai-usage", undefined);
    return;
  }
  if (cache.isInBackoff()) return;
  const cached: CopilotUsageData | null = cache.get();
  if (cached) {
    publishStatus(ctx, cached);
    return;
  }
  try {
    const apiKey: string | undefined =
      await ctx.modelRegistry.getApiKeyForProvider("github-copilot");
    if (!apiKey) return;
    const data: CopilotUsageData = await fetchCopilotUsage(apiKey);
    cache.set(data);
    publishStatus(ctx, data);
  } catch (error: unknown) {
    console.error("[pi-copilot-usage]", error);
    cache.setErrorBackoff();
  }
}

function publishStatus(ctx: ExtensionContext, data: CopilotUsageData): void {
  ctx.ui.setStatus(
    "zai-usage",
    JSON.stringify({
      percentage: data.percentage,
      resetTimeMs: data.resetTimeMs,
    }),
  );
}

function clearStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus("zai-usage", undefined);
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await refreshUsage(ctx);
    lastProvider = ctx.model?.provider;
  });
  pi.on("model_select", async (_event, ctx) => {
    const provider: string | undefined = ctx.model?.provider;
    if (provider !== lastProvider) {
      cache.clear();
    }
    lastProvider = provider;
    await refreshUsage(ctx);
  });
  pi.on("turn_end", async (_event, ctx) => {
    await refreshUsage(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearStatus(ctx);
  });
}
