import type { ProviderCategory } from "@/types";

/**
 * Gemini 预设供应商的视觉主题配置
 */
export interface GeminiPresetTheme {
  /** 图标类型：'gemini' | 'generic' */
  icon?: "gemini" | "generic";
  /** 背景色（选中状态），支持 hex 颜色 */
  backgroundColor?: string;
  /** 文字色（选中状态），支持 hex 颜色 */
  textColor?: string;
}

export interface GeminiProviderPreset {
  name: string;
  nameKey?: string; // i18n key for localized display name
  websiteUrl: string;
  apiKeyUrl?: string;
  settingsConfig: object;
  baseURL?: string;
  model?: string;
  description?: string;
  category?: ProviderCategory;
  isPartner?: boolean;
  primePartner?: boolean; // 置顶合作伙伴（顶级）：徽章显示为心形
  partnerPromotionKey?: string;
  endpointCandidates?: string[];
  theme?: GeminiPresetTheme;
  // 图标配置
  icon?: string; // 图标名称
  iconColor?: string; // 图标颜色
}

export const geminiProviderPresets: GeminiProviderPreset[] = [
  {
    name: "Google Official",
    websiteUrl: "https://ai.google.dev/",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    settingsConfig: {
      env: {},
    },
    description: "Google 官方 Gemini API (OAuth)",
    category: "official",
    partnerPromotionKey: "google-official",
    theme: {
      icon: "gemini",
      backgroundColor: "#4285F4",
      textColor: "#FFFFFF",
    },
    icon: "gemini",
    iconColor: "#4285F4",
  },
  {
    // 302.AI：与其他中转商相同的 Gemini 原生透传写法（根域名 + 模型名）。
    // 302 官方文档没有单独的 Gemini CLI 页面，此端点待真 key 验证。
    name: "302.AI",
    websiteUrl: "https://302.ai",
    apiKeyUrl: "https://302.ai",
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: "https://api.302.ai",
        GEMINI_API_KEY: "",
        GEMINI_MODEL: "gemini-3.5-flash",
      },
    },
    baseURL: "https://api.302.ai",
    model: "gemini-3.5-flash",
    description: "302.AI",
    category: "aggregator",
    endpointCandidates: ["https://api.302.ai", "https://api.302ai.cn"],
    icon: "ai302",
    iconColor: "#7C3AED",
  },
  {
    // 企业私有化：302 企业版 / 私有部署。与上面的 302.AI 同款 Gemini 原生透传，
    // 唯一区别是 base_url 留空，等用户填自己的私有部署地址（形如
    // https://your-company.302.ai）。归 third_party，提示语要求同时填 Key 和地址。
    name: "企业私有化",
    nameKey: "providerPreset.enterprise",
    websiteUrl: "https://302.ai",
    apiKeyUrl: "https://302.ai",
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: "",
        GEMINI_API_KEY: "",
        GEMINI_MODEL: "gemini-3.5-flash",
      },
    },
    model: "gemini-3.5-flash",
    description: "302.AI 企业私有化",
    category: "third_party",
    icon: "ai302",
    iconColor: "#7C3AED",
  },
  {
    name: "自定义",
    websiteUrl: "",
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: "",
        GEMINI_MODEL: "gemini-3.5-flash",
      },
    },
    model: "gemini-3.5-flash",
    description: "自定义 Gemini API 端点",
    category: "custom",
  },
];

export function getGeminiPresetByName(
  name: string,
): GeminiProviderPreset | undefined {
  return geminiProviderPresets.find((preset) => preset.name === name);
}

export function getGeminiPresetByUrl(
  url: string,
): GeminiProviderPreset | undefined {
  if (!url) return undefined;
  return geminiProviderPresets.find(
    (preset) =>
      preset.baseURL &&
      url.toLowerCase().includes(preset.baseURL.toLowerCase()),
  );
}
