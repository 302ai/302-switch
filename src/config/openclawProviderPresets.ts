/**
 * OpenClaw provider presets configuration
 * OpenClaw uses models.providers structure with custom provider configs
 */
import type {
  ProviderCategory,
  OpenClawProviderConfig,
  OpenClawDefaultModel,
} from "../types";
import type { PresetTheme, TemplateValueConfig } from "./claudeProviderPresets";

/** Suggested default model configuration for a preset */
export interface OpenClawSuggestedDefaults {
  /** Default model config to apply (agents.defaults.model) */
  model?: OpenClawDefaultModel;
  /** Model catalog entries to add (agents.defaults.models) */
  modelCatalog?: Record<string, { alias?: string }>;
}

export interface OpenClawProviderPreset {
  name: string;
  nameKey?: string; // i18n key for localized display name
  websiteUrl: string;
  apiKeyUrl?: string;
  /** OpenClaw settings_config structure */
  settingsConfig: OpenClawProviderConfig;
  isOfficial?: boolean;
  isPartner?: boolean;
  primePartner?: boolean; // 置顶合作伙伴（顶级）：徽章显示为心形
  partnerPromotionKey?: string;
  category?: ProviderCategory;
  /** Template variable definitions */
  templateValues?: Record<string, TemplateValueConfig>;
  /** Visual theme config */
  theme?: PresetTheme;
  /** Icon name */
  icon?: string;
  /** Icon color */
  iconColor?: string;
  /** Mark as custom template (for UI distinction) */
  isCustomTemplate?: boolean;
  /** Suggested default model configuration */
  suggestedDefaults?: OpenClawSuggestedDefaults;
}

function rebaseOpenClawModelRef(modelRef: string, providerKey: string): string {
  const slashIndex = modelRef.indexOf("/");
  return slashIndex === -1
    ? `${providerKey}/${modelRef}`
    : `${providerKey}${modelRef.slice(slashIndex)}`;
}

/**
 * OpenClaw default model refs are stored as "<provider-key>/<model-id>".
 * Presets carry stable built-in keys for display/tests, but the real key is
 * chosen in the add-provider form, so rewrite refs right before submission.
 */
export function rebaseOpenClawSuggestedDefaults(
  defaults: OpenClawSuggestedDefaults,
  providerKey: string,
): OpenClawSuggestedDefaults {
  const key = providerKey.trim();
  if (!key) return defaults;

  return {
    model: defaults.model
      ? {
          ...defaults.model,
          primary: rebaseOpenClawModelRef(defaults.model.primary, key),
          fallbacks: defaults.model.fallbacks?.map((modelRef) =>
            rebaseOpenClawModelRef(modelRef, key),
          ),
        }
      : undefined,
    modelCatalog: defaults.modelCatalog
      ? Object.fromEntries(
          Object.entries(defaults.modelCatalog).map(([modelRef, entry]) => [
            rebaseOpenClawModelRef(modelRef, key),
            entry,
          ]),
        )
      : undefined,
  };
}

/**
 * OpenClaw API protocol options
 * @see https://github.com/openclaw/openclaw/blob/main/docs/gateway/configuration.md
 */
export const openclawApiProtocols = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "bedrock-converse-stream", label: "AWS Bedrock" },
] as const;

/**
 * OpenClaw provider presets list
 */
export const openclawProviderPresets: OpenClawProviderPreset[] = [
  {
    // 302.AI：Anthropic Messages 协议直连 302 兼容层（官方 302oc CLI 同款端点）。
    name: "302.AI（国内）",
    websiteUrl: "https://api.302ai.cn",
    apiKeyUrl: "https://302.ai",
    settingsConfig: {
      baseUrl: "https://api.302ai.cn",
      apiKey: "",
      api: "anthropic-messages",
      models: [
        {
          id: "claude-opus-4-8",
          name: "Claude Opus 4.8",
          contextWindow: 200000,
        },
        {
          id: "claude-sonnet-5",
          name: "Claude Sonnet 5",
          contextWindow: 200000,
        },
      ],
    },
    category: "aggregator",
    icon: "ai302",
    iconColor: "#7C3AED",
    templateValues: {
      apiKey: {
        label: "API Key",
        placeholder: "",
        editorValue: "",
      },
    },
    suggestedDefaults: {
      model: {
        primary: "302ai/claude-opus-4-8",
        fallbacks: ["302ai/claude-sonnet-5"],
      },
      modelCatalog: {
        "302ai/claude-opus-4-8": { alias: "Opus" },
        "302ai/claude-sonnet-5": { alias: "Sonnet" },
      },
    },
  },
  {
    name: "302.AI（海外）",
    websiteUrl: "https://api.302.ai",
    apiKeyUrl: "https://302.ai",
    settingsConfig: {
      baseUrl: "https://api.302.ai",
      apiKey: "",
      api: "anthropic-messages",
      models: [
        {
          id: "claude-opus-4-8",
          name: "Claude Opus 4.8",
          contextWindow: 200000,
        },
        {
          id: "claude-sonnet-5",
          name: "Claude Sonnet 5",
          contextWindow: 200000,
        },
      ],
    },
    category: "aggregator",
    icon: "ai302",
    iconColor: "#7C3AED",
    templateValues: {
      apiKey: {
        label: "API Key",
        placeholder: "",
        editorValue: "",
      },
    },
    suggestedDefaults: {
      model: {
        primary: "302ai/claude-opus-4-8",
        fallbacks: ["302ai/claude-sonnet-5"],
      },
      modelCatalog: {
        "302ai/claude-opus-4-8": { alias: "Opus" },
        "302ai/claude-sonnet-5": { alias: "Sonnet" },
      },
    },
  },
  {
    // 企业私有化：302 企业版 / 私有部署，与 302.AI（海外）同款接入，
    // baseUrl / 官网链接留空，等用户填自己的私有部署地址。
    name: "企业私有化",
    nameKey: "providerPreset.enterprise",
    websiteUrl: "",
    apiKeyUrl: "",
    settingsConfig: {
      baseUrl: "",
      apiKey: "",
      api: "anthropic-messages",
      models: [
        {
          id: "claude-opus-4-8",
          name: "Claude Opus 4.8",
          contextWindow: 200000,
        },
        {
          id: "claude-sonnet-5",
          name: "Claude Sonnet 5",
          contextWindow: 200000,
        },
      ],
    },
    category: "third_party",
    icon: "ai302",
    iconColor: "#7C3AED",
    templateValues: {
      apiKey: {
        label: "API Key",
        placeholder: "",
        editorValue: "",
      },
    },
    suggestedDefaults: {
      model: {
        primary: "302ai/claude-opus-4-8",
        fallbacks: ["302ai/claude-sonnet-5"],
      },
      modelCatalog: {
        "302ai/claude-opus-4-8": { alias: "Opus" },
        "302ai/claude-sonnet-5": { alias: "Sonnet" },
      },
    },
  },
];
