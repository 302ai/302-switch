/**
 * Codex 预设供应商配置模板
 */
import { ProviderCategory } from "../types";
import type {
  CodexApiFormat,
  CodexCatalogModel,
  CodexChatReasoning,
} from "../types";
import type { PresetTheme } from "./claudeProviderPresets";

export interface CodexProviderPreset {
  name: string;
  nameKey?: string; // i18n key for localized display name
  websiteUrl: string;
  // 第三方供应商可提供单独的获取 API Key 链接
  apiKeyUrl?: string;
  auth: Record<string, any>; // 将写入 ~/.codex/auth.json
  config: string; // 将写入 ~/.codex/config.toml（TOML 字符串）
  isOfficial?: boolean; // 标识是否为官方预设
  isPartner?: boolean; // 标识是否为商业合作伙伴
  primePartner?: boolean; // 置顶合作伙伴（顶级）：徽章显示为心形
  partnerPromotionKey?: string; // 合作伙伴促销信息的 i18n key
  category?: ProviderCategory; // 新增：分类
  isCustomTemplate?: boolean; // 标识是否为自定义模板
  // 新增：请求地址候选列表（用于地址管理/测速）
  endpointCandidates?: string[];
  // 新增：视觉主题配置
  theme?: PresetTheme;
  // 图标配置
  icon?: string; // 图标名称
  iconColor?: string; // 图标颜色
  // Codex API 格式
  apiFormat?: CodexApiFormat;
  // Codex Chat 本地路由模式下的模型目录
  modelCatalog?: CodexCatalogModel[];
  // Codex Responses -> Chat Completions reasoning capability defaults
  codexChatReasoning?: CodexChatReasoning;
}

/**
 * 生成第三方供应商的 auth.json
 */
export function generateThirdPartyAuth(apiKey: string): Record<string, any> {
  return {
    OPENAI_API_KEY: apiKey || "",
  };
}

/**
 * 生成第三方供应商的 config.toml
 *
 * modelName 传 null = 不写 model 行（自动路由）：Codex 客户端按任务自选模型，
 * 请求原样发给上游。传字符串则钉死默认模型。
 */
export function generateThirdPartyConfig(
  providerName: string,
  baseUrl: string,
  modelName: string | null = "gpt-5.5",
  requiresOpenAiAuth = true,
): string {
  const tomlString = (value: string) => JSON.stringify(value);
  const modelLine = modelName ? `model = ${tomlString(modelName)}\n` : "";

  return `model_provider = "custom"
${modelLine}model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.custom]
name = ${tomlString(providerName)}
base_url = ${tomlString(baseUrl)}
wire_api = "responses"
requires_openai_auth = ${requiresOpenAiAuth}`;
}

function modelCatalog(
  models: Array<
    | string
    | {
        model: string;
        displayName?: string;
        contextWindow?: number;
        // Native Responses (direct) overrides for the generated
        // model-catalogs.json; omit to inherit the native template defaults
        // (supports_parallel_tool_calls=false, input_modalities=["text"]).
        supportsParallelToolCalls?: boolean;
        inputModalities?: string[];
        // Vendor's OFFICIAL base_instructions; omit to inherit the neutral
        // template default. Required by Codex, so the backend always emits one.
        baseInstructions?: string;
      }
  >,
): CodexCatalogModel[] {
  return models.map((entry) =>
    typeof entry === "string"
      ? { model: entry }
      : {
          model: entry.model,
          displayName: entry.displayName,
          contextWindow: entry.contextWindow,
          supportsParallelToolCalls: entry.supportsParallelToolCalls,
          inputModalities: entry.inputModalities,
          baseInstructions: entry.baseInstructions,
        },
  );
}

export const codexProviderPresets: CodexProviderPreset[] = [
  {
    name: "OpenAI Official",
    websiteUrl: "https://chatgpt.com/codex",
    isOfficial: true,
    category: "official",
    auth: {},
    config: ``,
    theme: {
      icon: "codex",
      backgroundColor: "#1F2937", // gray-800
      textColor: "#FFFFFF",
    },
    icon: "openai",
    iconColor: "#00A67E",
  },
  {
    // 302.AI 的海外、国内 Codex Responses 节点都直接使用 /v1。
    // 两者都直连，不需要本地 Responses→Chat 转换（openai_responses = 原生透传）。
    // 不钉 model、不带 modelCatalog = 自动路由：Codex 保留自己的模型列表，
    // 按任务自选（sol / mini 等），302 按实际收到的模型 id 计费。
    name: "302.AI",
    websiteUrl: "https://302.ai",
    apiKeyUrl: "https://302.ai",
    auth: generateThirdPartyAuth(""),
    config: generateThirdPartyConfig(
      "302ai",
      "https://api.302.ai/v1",
      null,
      false,
    ),
    endpointCandidates: ["https://api.302.ai/v1", "https://api.302ai.cn/v1"],
    apiFormat: "openai_responses",
    category: "aggregator",
    icon: "ai302",
    iconColor: "#7C3AED",
  },
  {
    // 企业私有化：302 企业版 / 私有部署。原生 Responses 透传，与上面的 302.AI 同款，
    // 唯一区别是 base_url 生成成空串（占位），等用户填自己的私有部署地址
    //（形如 https://your-company.302.ai/v1）。归 third_party，提示语要求同时填
    // API Key 和请求地址。不钉 model = 自动路由。
    name: "企业私有化",
    nameKey: "providerPreset.enterprise",
    websiteUrl: "https://302.ai",
    apiKeyUrl: "https://302.ai",
    auth: generateThirdPartyAuth(""),
    config: generateThirdPartyConfig("302ai-enterprise", "", null, false),
    apiFormat: "openai_responses",
    category: "third_party",
    icon: "ai302",
    iconColor: "#7C3AED",
  },
  {
    // OpenAI 官方直连 API：真实 sk-... Key，按量计费，走原生 Responses 接口
    // （不需要像 302.AI 那样本地转换成 Chat Completions）。跟"OpenAI Official"
    // （订阅登录）是两码事，分开一张卡，避免和订阅账号混在一起。
    name: "OpenAI API",
    websiteUrl: "https://platform.openai.com",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    auth: generateThirdPartyAuth(""),
    config: generateThirdPartyConfig("openai-api", "https://api.openai.com/v1"),
    endpointCandidates: ["https://api.openai.com/v1"],
    apiFormat: "openai_responses",
    modelCatalog: modelCatalog([
      { model: "gpt-5.5", displayName: "GPT-5.5", contextWindow: 400000 },
    ]),
    category: "custom",
    icon: "openai",
    iconColor: "#00A67E",
  },
];
