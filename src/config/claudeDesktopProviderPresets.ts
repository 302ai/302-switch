/**
 * Claude Desktop 预设供应商配置模板
 *
 * 形态与 Claude Code 预设不同：
 * - baseUrl 是顶级字段，而不是 settingsConfig.env.ANTHROPIC_BASE_URL
 * - 模型信息以"Desktop 可见模型 ID → 上游模型"表达，
 *   对应后端 ClaudeDesktopModelRoute 的 routeId / model
 *
 * 翻译来源：src/config/claudeProviderPresets.ts（排除 OAuth 与不兼容预设）
 */
import { ProviderCategory } from "../types";
import type { PresetTheme } from "./claudeProviderPresets";

export type ClaudeDesktopApiFormat =
  | "anthropic"
  | "openai_chat"
  | "openai_responses"
  | "gemini_native";

export interface ClaudeDesktopRoutePreset {
  routeId: string;
  upstreamModel: string;
  labelOverride?: string;
  supports1m: boolean;
}

/**
 * Claude Desktop 3P fail-all 校验接受的角色名。Desktop 1.12603.1+ 起白名单
 * 纳入 fable（app.asar 内 ["sonnet","opus","haiku","fable","mythos"]，实测
 * 2026-06-13）；此前 1.6259.1 仅接受 sonnet/opus/haiku。mythos 官方未公开
 * 发布，暂不暴露给用户。所有预设工厂、表单角色下拉、后端
 * `next_catalog_safe_route_id` 都从此映射派生 routeId，避免散落硬编码。
 */
export const CLAUDE_DESKTOP_ROLE_ROUTE_IDS = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-4-8",
  fable: "claude-fable-5",
  haiku: "claude-haiku-4-5",
} as const;

export type ClaudeDesktopRoleId = keyof typeof CLAUDE_DESKTOP_ROLE_ROUTE_IDS;

export interface ClaudeDesktopProviderPreset {
  name: string;
  nameKey?: string;
  websiteUrl: string;
  apiKeyUrl?: string;
  category?: ProviderCategory;
  isPartner?: boolean;
  primePartner?: boolean; // 置顶合作伙伴（顶级）：徽章显示为心形
  partnerPromotionKey?: string;

  baseUrl: string;
  apiKeyField?: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";

  mode: "direct" | "proxy";
  apiFormat?: ClaudeDesktopApiFormat;
  modelRoutes?: ClaudeDesktopRoutePreset[];
  providerType?: "github_copilot" | "codex_oauth";
  requiresOAuth?: boolean;

  endpointCandidates?: string[];
  theme?: PresetTheme;
  icon?: string;
  iconColor?: string;
}

const passthroughRoutes = (supports1m = false): ClaudeDesktopRoutePreset[] => [
  {
    routeId: CLAUDE_DESKTOP_ROLE_ROUTE_IDS.sonnet,
    upstreamModel: CLAUDE_DESKTOP_ROLE_ROUTE_IDS.sonnet,
    supports1m,
  },
  {
    routeId: CLAUDE_DESKTOP_ROLE_ROUTE_IDS.opus,
    upstreamModel: CLAUDE_DESKTOP_ROLE_ROUTE_IDS.opus,
    supports1m,
  },
  {
    routeId: CLAUDE_DESKTOP_ROLE_ROUTE_IDS.haiku,
    upstreamModel: CLAUDE_DESKTOP_ROLE_ROUTE_IDS.haiku,
    supports1m,
  },
];

export const claudeDesktopProviderPresets: ClaudeDesktopProviderPreset[] = [
  {
    name: "Claude Desktop Official",
    websiteUrl: "https://claude.ai/download",
    category: "official",
    baseUrl: "",
    mode: "direct",
    apiFormat: "anthropic",
    theme: {
      icon: "claude",
      backgroundColor: "#D97757",
      textColor: "#FFFFFF",
    },
    icon: "anthropic",
    iconColor: "#D4915D",
  },
  {
    // 302.AI Anthropic 兼容层直连；模型走 sonnet/opus/haiku 透传路由。
    name: "302.AI",
    websiteUrl: "https://302.ai",
    apiKeyUrl: "https://302.ai",
    category: "aggregator",
    baseUrl: "https://api.302.ai",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    mode: "direct",
    apiFormat: "anthropic",
    modelRoutes: passthroughRoutes(),
    endpointCandidates: ["https://api.302.ai", "https://api.302ai.cn"],
    icon: "ai302",
    iconColor: "#7C3AED",
  },
  {
    // 企业私有化：302 企业版 / 私有部署。与上面 302.AI 同款 Anthropic 兼容层直连，
    // 区别是 baseUrl 留空、官网链接不预填，等用户填自己的私有部署地址。third_party。
    name: "企业私有化",
    nameKey: "providerPreset.enterprise",
    websiteUrl: "",
    category: "third_party",
    baseUrl: "",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    mode: "direct",
    apiFormat: "anthropic",
    modelRoutes: passthroughRoutes(),
    icon: "ai302",
    iconColor: "#7C3AED",
  },
];
