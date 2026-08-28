import { describe, expect, it } from "vitest";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import { claudeDesktopProviderPresets } from "@/config/claudeDesktopProviderPresets";
import { opencodeProviderPresets } from "@/config/opencodeProviderPresets";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";
import { hermesProviderPresets } from "@/config/hermesProviderPresets";
import { AI302_SEED_IDS_CN } from "@/config/ai302";

// 国内、海外 302.AI 节点必须是可辨认、可独立选择的预设。

describe("302.AI presets across apps", () => {
  it("Claude: official + 302.AI + enterprise self-hosted", () => {
    expect(providerPresets.map((p) => p.name)).toEqual([
      "Claude Official",
      "302.AI",
      "企业私有化",
    ]);
  });

  it("Claude: enterprise preset ships empty base URL for the user to fill", () => {
    const p = providerPresets.find((x) => x.name === "企业私有化")!;
    const env = (p.settingsConfig as any).env;
    // base_url 留空 = 用户填自己的私有部署地址；沿用 302 的 API Key 字段和分类语义
    expect(env.ANTHROPIC_BASE_URL).toBe("");
    expect(env).toHaveProperty("ANTHROPIC_API_KEY", "");
    expect(p.apiKeyField).toBe("ANTHROPIC_API_KEY");
    expect(p.category).toBe("third_party");
    expect(p.nameKey).toBe("providerPreset.enterprise");
    // 官网链接不预填
    expect(p.websiteUrl).toBe("");
  });

  it("Claude: 302.AI uses Anthropic-compatible root with API key field", () => {
    const p = providerPresets.find((x) => x.name === "302.AI")!;
    const env = (p.settingsConfig as any).env;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.302.ai");
    expect(env).toHaveProperty("ANTHROPIC_API_KEY", "");
    expect(p.apiKeyField).toBe("ANTHROPIC_API_KEY");
    // 国内节点作为测速候选
    expect(p.endpointCandidates).toContain("https://api.302ai.cn");
    expect(AI302_SEED_IDS_CN.claude).toBe("ai302-cn-claude");
  });

  it("Codex: official + 302.AI + OpenAI API (direct escape hatch)", () => {
    // 唯一的例外：Codex 额外保留一张"OpenAI API"直连卡，作为绕开 302.AI 的
    // 官方逃生舱——主理人明确要求给自己留一条直连 OpenAI 的路，不受
    // "只有官方+302.AI" 这条约定约束。
    expect(codexProviderPresets.map((p) => p.name)).toEqual([
      "OpenAI Official",
      "302.AI",
      "企业私有化",
      "OpenAI API",
    ]);
    // 企业私有化：base_url 生成为空串（占位），等用户填私有部署地址
    const ent = codexProviderPresets.find((x) => x.name === "企业私有化")!;
    expect(ent.config).toContain('base_url = ""');
    expect(ent.config).toContain("requires_openai_auth = false");
    expect(ent.category).toBe("third_party");
    expect(ent.nameKey).toBe("providerPreset.enterprise");
    expect(ent.websiteUrl).toBe(""); // 官网链接不预填
    // 302 的海外、国内地址都直接使用 /v1，没有 /codex 路径
    const p = codexProviderPresets.find((x) => x.name === "302.AI")!;
    expect(p.config).toContain('base_url = "https://api.302.ai/v1"');
    expect(p.config).toContain("requires_openai_auth = false");
    expect(p.config).not.toContain("/codex/");
    expect(p.endpointCandidates).toContain("https://api.302.ai/v1");
    expect(p.endpointCandidates).toContain("https://api.302ai.cn/v1");
    expect(p.endpointCandidates?.every((url) => !url.includes("/codex/"))).toBe(
      true,
    );
    expect(p.apiFormat).toBe("openai_responses");
    expect(p.auth).toHaveProperty("OPENAI_API_KEY", "");
    expect(AI302_SEED_IDS_CN.codex).toBe("ai302-cn-codex");

    const direct = codexProviderPresets.find((x) => x.name === "OpenAI API")!;
    expect(direct.config).toContain('base_url = "https://api.openai.com/v1"');
    expect(direct.apiFormat).toBe("openai_responses");
    expect(direct.category).toBe("custom");
    expect(direct.auth).toHaveProperty("OPENAI_API_KEY", "");
  });

  it("Gemini: official + 302.AI + enterprise + custom template", () => {
    expect(geminiProviderPresets.map((p) => p.name)).toEqual([
      "Google Official",
      "302.AI",
      "企业私有化",
      "自定义",
    ]);
    const p = geminiProviderPresets.find((x) => x.name === "302.AI")!;
    expect(p.baseURL).toBe("https://api.302.ai");
    expect((p.settingsConfig as any).env).toHaveProperty("GEMINI_API_KEY", "");
    expect(AI302_SEED_IDS_CN.gemini).toBe("ai302-cn-gemini");

    // 企业私有化：base_url 留空，等用户填私有部署地址
    const ent = geminiProviderPresets.find((x) => x.name === "企业私有化")!;
    expect((ent.settingsConfig as any).env.GOOGLE_GEMINI_BASE_URL).toBe("");
    expect((ent.settingsConfig as any).env).toHaveProperty(
      "GEMINI_API_KEY",
      "",
    );
    expect(ent.category).toBe("third_party");
    expect(ent.nameKey).toBe("providerPreset.enterprise");
    expect(ent.websiteUrl).toBe(""); // 官网链接不预填
  });

  it("Claude Desktop: official + 302.AI + enterprise, passthrough routes", () => {
    expect(claudeDesktopProviderPresets.map((p) => p.name)).toEqual([
      "Claude Desktop Official",
      "302.AI",
      "企业私有化",
    ]);
    const p = claudeDesktopProviderPresets.find((x) => x.name === "302.AI")!;
    expect(p.baseUrl).toBe("https://api.302.ai");
    expect(p.apiFormat).toBe("anthropic");
    expect(p.modelRoutes?.length).toBe(3);

    // 企业私有化：baseUrl 与官网链接都留空，等用户填私有部署地址
    const ent = claudeDesktopProviderPresets.find(
      (x) => x.name === "企业私有化",
    )!;
    expect(ent.baseUrl).toBe("");
    expect(ent.websiteUrl).toBe("");
    expect(ent.category).toBe("third_party");
    expect(ent.nameKey).toBe("providerPreset.enterprise");
  });

  it("OpenCode: both 302.AI regions + enterprise + custom templates", () => {
    expect(opencodeProviderPresets.map((p) => p.name)).toEqual([
      "302.AI（国内）",
      "302.AI（海外）",
      "企业私有化",
      "Oh My OpenCode",
      "Oh My OpenCode Slim",
    ]);
    // 企业私有化：baseURL 与官网链接都留空，等用户填私有部署地址
    const ent = opencodeProviderPresets.find((x) => x.name === "企业私有化")!;
    expect((ent.settingsConfig.options as any).baseURL).toBe("");
    expect(ent.websiteUrl).toBe("");
    expect(ent.category).toBe("third_party");
    expect(ent.nameKey).toBe("providerPreset.enterprise");
    const overseas = opencodeProviderPresets.find(
      (x) => x.name === "302.AI（海外）",
    )!;
    const domestic = opencodeProviderPresets.find(
      (x) => x.name === "302.AI（国内）",
    )!;
    expect(overseas.settingsConfig.npm).toBe("@ai-sdk/anthropic");
    expect(domestic.settingsConfig.npm).toBe("@ai-sdk/anthropic");
    expect((overseas.settingsConfig.options as any).baseURL).toBe(
      "https://api.302.ai/v1",
    );
    expect((domestic.settingsConfig.options as any).baseURL).toBe(
      "https://api.302ai.cn/v1",
    );
  });

  it("OpenClaw: both 302.AI regions + enterprise use anthropic-messages", () => {
    expect(openclawProviderPresets.map((p) => p.name)).toEqual([
      "302.AI（国内）",
      "302.AI（海外）",
      "企业私有化",
    ]);
    const [domestic, overseas] = openclawProviderPresets;
    expect(overseas.settingsConfig.baseUrl).toBe("https://api.302.ai");
    expect(domestic.settingsConfig.baseUrl).toBe("https://api.302ai.cn");
    expect(overseas.settingsConfig.api).toBe("anthropic-messages");
    expect(domestic.settingsConfig.api).toBe("anthropic-messages");

    // 企业私有化：baseUrl 与官网链接都留空，等用户填私有部署地址
    const ent = openclawProviderPresets.find((x) => x.name === "企业私有化")!;
    expect(ent.settingsConfig.baseUrl).toBe("");
    expect(ent.settingsConfig.api).toBe("anthropic-messages");
    expect(ent.websiteUrl).toBe("");
    expect(ent.category).toBe("third_party");
    expect(ent.nameKey).toBe("providerPreset.enterprise");
  });

  it("Hermes: official + both 302.AI regions + enterprise", () => {
    expect(hermesProviderPresets.map((p) => p.name)).toEqual([
      "Nous Research",
      "302.AI（国内）",
      "302.AI（海外）",
      "企业私有化",
    ]);
    const overseas = hermesProviderPresets.find(
      (x) => x.name === "302.AI（海外）",
    )!;
    const domestic = hermesProviderPresets.find(
      (x) => x.name === "302.AI（国内）",
    )!;
    expect(overseas.settingsConfig.base_url).toBe("https://api.302.ai/v1");
    expect(domestic.settingsConfig.base_url).toBe("https://api.302ai.cn/v1");
    expect(overseas.settingsConfig.api_mode).toBe("chat_completions");
    expect(domestic.settingsConfig.api_mode).toBe("chat_completions");

    // 企业私有化：base_url 与官网链接都留空，等用户填私有部署地址
    const ent = hermesProviderPresets.find((x) => x.name === "企业私有化")!;
    expect(ent.settingsConfig.base_url).toBe("");
    expect(ent.settingsConfig.api_mode).toBe("chat_completions");
    expect(ent.websiteUrl).toBe("");
    expect(ent.category).toBe("third_party");
    expect(ent.nameKey).toBe("providerPreset.enterprise");
  });

  it("no partner promotions remain in any preset list", () => {
    const all = [
      ...providerPresets,
      ...codexProviderPresets,
      ...geminiProviderPresets.filter((p) => p.name !== "Google Official"),
      ...claudeDesktopProviderPresets,
      ...opencodeProviderPresets,
      ...openclawProviderPresets,
      ...hermesProviderPresets,
    ];
    expect(all.every((p) => !p.isPartner)).toBe(true);
  });
});
