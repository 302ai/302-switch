// 302.AI 产品化的共享判定与常量。
// 种子 id 清单的事实源在后端 src-tauri/src/database/dao/providers_seed.rs（AI302_SEEDS），
// 前端只依赖它们统一的 "ai302-" 前缀，避免两边维护同一份 id 列表。

import type { AppId } from "@/lib/api/types";
import type { Provider } from "@/types";

const AI302_SEED_PREFIX = "ai302-";

// 用户领取 / 查看 API Key 的入口页（302.AI 控制台）
export const AI302_API_KEY_URL = "https://dash.302.ai/apis/list";

// 302 聚合接口根地址（海外／国内两个标准节点，种子配置的默认值，验证 Key 时兜底用）
export const AI302_API_BASE_URL = "https://api.302.ai";
export const AI302_API_BASE_URL_CN = "https://api.302ai.cn";

export const AI302_ONBOARDING_APPS = ["claude", "codex", "gemini"] as const;

export type Ai302OnboardingApp = (typeof AI302_ONBOARDING_APPS)[number];

/** 公共版两个区域，对应后端预置的两套种子。企业版（私有部署）复用海外槽位改写地址。 */
export type Ai302Region = "cn" | "global";

export const AI302_SEED_IDS_GLOBAL: Record<Ai302OnboardingApp, string> = {
  claude: "ai302-claude",
  codex: "ai302-codex",
  gemini: "ai302-gemini",
};

export const AI302_SEED_IDS_CN: Record<Ai302OnboardingApp, string> = {
  claude: "ai302-cn-claude",
  codex: "ai302-cn-codex",
  gemini: "ai302-cn-gemini",
};

export function getAi302SeedId(
  appId: Ai302OnboardingApp,
  region: Ai302Region,
): string {
  return region === "cn"
    ? AI302_SEED_IDS_CN[appId]
    : AI302_SEED_IDS_GLOBAL[appId];
}

export function getAi302RegionBaseUrl(region: Ai302Region): string {
  return region === "cn" ? AI302_API_BASE_URL_CN : AI302_API_BASE_URL;
}

// 已知的 302.AI 官方域名——用来判断某个 provider 当前挂的是标准公共节点，
// 还是被 onboarding/编辑框改写过的企业私有部署地址。
const AI302_KNOWN_HOSTS = new Set(["api.302.ai", "api.302ai.cn"]);

export function isAi302CustomEndpoint(baseUrl: string): boolean {
  try {
    return !AI302_KNOWN_HOSTS.has(new URL(baseUrl).host);
  } catch {
    // 解析失败（用户还没填完）也当作自定义，UI 走可编辑分支更安全
    return true;
  }
}

/** 去掉尾部斜杠和用户误粘贴的 /v1，得到统一的"根地址"，后续按各 app 的形状拼接。 */
export function normalizeAi302RootUrl(input: string): string {
  return input.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

export function isValidAi302BaseUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// 企业版填的地址不一定是 302.AI——填了自己的 base URL 就有可能是任何 OpenAI
// 兼容中转商。这里只覆盖测试/常见的几个知名域名，识别不到就不瞎猜，直接
// 回落到不带品牌的通用 "API Key"，好过硬贴一个大概率错的 "302.AI"。
const KNOWN_API_HOSTS: Record<string, string> = {
  "openrouter.ai": "OpenRouter",
  "api.openai.com": "OpenAI",
  "api.anthropic.com": "Anthropic",
  "api.deepseek.com": "DeepSeek",
  "api.moonshot.cn": "Moonshot",
  "api.groq.com": "Groq",
  "api.together.xyz": "Together AI",
};

export function detectAi302BrandName(root: string): string | null {
  try {
    return KNOWN_API_HOSTS[new URL(root).host] ?? null;
  } catch {
    return null;
  }
}

export function detectAi302ApiKeyLabel(root: string): string {
  const brand = detectAi302BrandName(root);
  return brand ? `${brand} API Key` : "API Key";
}

export interface Ai302ModelMapping {
  role: "sonnet" | "opus" | "fable" | "haiku" | "subagent" | "default";
  model: string;
}

export interface Ai302ModelStrategy {
  mode: "follow" | "fixed";
  mappings: Ai302ModelMapping[];
}

// 302 内置种子供应商：不可删除，编辑时走「只填 Key」精简表单
export function isAi302SeedProvider(provider: Pick<Provider, "id">): boolean {
  return provider.id.startsWith(AI302_SEED_PREFIX);
}

export function readAi302ApiKey(
  appId: AppId,
  config: Record<string, unknown>,
): string {
  if (appId === "opencode") {
    const options = config.options as Record<string, unknown> | undefined;
    return typeof options?.apiKey === "string" ? options.apiKey : "";
  }
  if (appId === "openclaw") {
    return typeof config.apiKey === "string" ? config.apiKey : "";
  }
  if (appId === "hermes") {
    return typeof config.api_key === "string" ? config.api_key : "";
  }
  if (appId === "codex") {
    const auth = config.auth as Record<string, unknown> | undefined;
    return typeof auth?.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY : "";
  }
  const env = config.env as Record<string, unknown> | undefined;
  if (appId === "claude-desktop") {
    const authToken = env?.ANTHROPIC_AUTH_TOKEN;
    if (typeof authToken === "string" && authToken.trim()) return authToken;
    const legacyApiKey = env?.ANTHROPIC_API_KEY;
    return typeof legacyApiKey === "string" ? legacyApiKey : "";
  }
  const field = appId === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  return typeof env?.[field] === "string" ? (env[field] as string) : "";
}

export function writeAi302ApiKey(
  appId: AppId,
  config: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  if (appId === "opencode") {
    const options = (config.options ?? {}) as Record<string, unknown>;
    return { ...config, options: { ...options, apiKey: key } };
  }
  if (appId === "openclaw") {
    return { ...config, apiKey: key };
  }
  if (appId === "hermes") {
    return { ...config, api_key: key };
  }
  if (appId === "codex") {
    const auth = (config.auth ?? {}) as Record<string, unknown>;
    return { ...config, auth: { ...auth, OPENAI_API_KEY: key } };
  }
  const env = (config.env ?? {}) as Record<string, unknown>;
  if (appId === "claude-desktop") {
    const nextEnv: Record<string, unknown> = {
      ...env,
      ANTHROPIC_AUTH_TOKEN: key,
    };
    delete nextEnv.ANTHROPIC_API_KEY;
    return { ...config, env: nextEnv };
  }
  const field = appId === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  return { ...config, env: { ...env, [field]: key } };
}

/**
 * 把一个"根地址"（如 https://your-company.302.ai）按各 app 的配置形状写入。
 * 镜像 readAi302BaseUrl 的分支结构——Codex 拼 /v1 到 TOML 里的 base_url，
 * Claude/Gemini 系直接写根域名，其余几家在 /v1 层接入。
 */
export function writeAi302BaseUrl(
  appId: AppId,
  config: Record<string, unknown>,
  baseUrl: string,
): Record<string, unknown> {
  const root = normalizeAi302RootUrl(baseUrl);
  if (appId === "opencode") {
    const options = (config.options ?? {}) as Record<string, unknown>;
    return { ...config, options: { ...options, baseURL: `${root}/v1` } };
  }
  if (appId === "openclaw") {
    return { ...config, baseUrl: root };
  }
  if (appId === "hermes") {
    return { ...config, base_url: `${root}/v1` };
  }
  if (appId === "codex") {
    const toml = typeof config.config === "string" ? config.config : "";
    const nextToml = toml.replace(
      /^(\s*base_url\s*=\s*)["'][^"']*["']/m,
      `$1"${root}/v1"`,
    );
    return { ...config, config: nextToml };
  }
  const env = (config.env ?? {}) as Record<string, unknown>;
  const field =
    appId === "gemini" ? "GOOGLE_GEMINI_BASE_URL" : "ANTHROPIC_BASE_URL";
  return { ...config, env: { ...env, [field]: root } };
}

export function readAi302BaseUrl(
  appId: AppId,
  config: Record<string, unknown>,
): string {
  if (appId === "opencode") {
    const options = config.options as Record<string, unknown> | undefined;
    const value = options?.baseURL;
    return typeof value === "string" && value.trim()
      ? value
      : `${AI302_API_BASE_URL}/v1`;
  }
  if (appId === "openclaw") {
    const value = config.baseUrl;
    return typeof value === "string" && value.trim()
      ? value
      : AI302_API_BASE_URL;
  }
  if (appId === "hermes") {
    const value = config.base_url;
    return typeof value === "string" && value.trim()
      ? value
      : `${AI302_API_BASE_URL}/v1`;
  }
  if (appId === "codex") {
    const toml = typeof config.config === "string" ? config.config : "";
    const match = toml.match(/^\s*base_url\s*=\s*["']([^"']+)["']/m);
    return match?.[1] || `${AI302_API_BASE_URL}/v1`;
  }
  const env = config.env as Record<string, unknown> | undefined;
  const field =
    appId === "gemini" ? "GOOGLE_GEMINI_BASE_URL" : "ANTHROPIC_BASE_URL";
  const value = env?.[field];
  return typeof value === "string" && value.trim() ? value : AI302_API_BASE_URL;
}

export function getAi302ModelStrategy(
  appId: AppId,
  config: Record<string, unknown>,
): Ai302ModelStrategy {
  const env = (config.env ?? {}) as Record<string, unknown>;
  if (appId === "claude" || appId === "claude-desktop") {
    const fields: Array<[Ai302ModelMapping["role"], string]> = [
      ["sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL"],
      ["opus", "ANTHROPIC_DEFAULT_OPUS_MODEL"],
      ["fable", "ANTHROPIC_DEFAULT_FABLE_MODEL"],
      ["haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL"],
      ["subagent", "CLAUDE_CODE_SUBAGENT_MODEL"],
      ["default", "ANTHROPIC_MODEL"],
    ];
    const mappings = fields.flatMap(([role, field]) => {
      const value = env[field];
      return typeof value === "string" && value.trim()
        ? [{ role, model: value.trim() }]
        : [];
    });
    return { mode: mappings.length > 0 ? "fixed" : "follow", mappings };
  }

  if (appId === "codex") {
    const toml = typeof config.config === "string" ? config.config : "";
    const model = toml.match(/^\s*model\s*=\s*["']([^"']+)["']/m)?.[1];
    return model
      ? { mode: "fixed", mappings: [{ role: "default", model }] }
      : { mode: "follow", mappings: [] };
  }

  if (appId === "gemini") {
    const model = env.GEMINI_MODEL;
    return typeof model === "string" && model.trim()
      ? {
          mode: "fixed",
          mappings: [{ role: "default", model: model.trim() }],
        }
      : { mode: "follow", mappings: [] };
  }

  if (appId === "opencode") {
    const models = config.models as Record<string, unknown> | undefined;
    const model = models ? Object.keys(models)[0] : undefined;
    return model
      ? { mode: "fixed", mappings: [{ role: "default", model }] }
      : { mode: "follow", mappings: [] };
  }

  if (appId === "openclaw" || appId === "hermes") {
    const models = Array.isArray(config.models) ? config.models : [];
    const model = models
      .map((item) =>
        item && typeof item === "object"
          ? (item as Record<string, unknown>).id
          : undefined,
      )
      .find((id): id is string => typeof id === "string" && id.trim() !== "");
    return model
      ? { mode: "fixed", mappings: [{ role: "default", model }] }
      : { mode: "follow", mappings: [] };
  }

  return { mode: "follow", mappings: [] };
}
