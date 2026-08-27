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
  it("Claude: official + 302.AI only", () => {
    expect(providerPresets.map((p) => p.name)).toEqual([
      "Claude Official",
      "302.AI",
    ]);
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
      "OpenAI API",
    ]);
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

  it("Gemini: official + 302.AI + custom template", () => {
    expect(geminiProviderPresets.map((p) => p.name)).toEqual([
      "Google Official",
      "302.AI",
      "自定义",
    ]);
    const p = geminiProviderPresets.find((x) => x.name === "302.AI")!;
    expect(p.baseURL).toBe("https://api.302.ai");
    expect((p.settingsConfig as any).env).toHaveProperty("GEMINI_API_KEY", "");
    expect(AI302_SEED_IDS_CN.gemini).toBe("ai302-cn-gemini");
  });

  it("Claude Desktop: official + 302.AI only, passthrough routes", () => {
    expect(claudeDesktopProviderPresets.map((p) => p.name)).toEqual([
      "Claude Desktop Official",
      "302.AI",
    ]);
    const p = claudeDesktopProviderPresets.find((x) => x.name === "302.AI")!;
    expect(p.baseUrl).toBe("https://api.302.ai");
    expect(p.apiFormat).toBe("anthropic");
    expect(p.modelRoutes?.length).toBe(3);
  });

  it("OpenCode: both 302.AI regions + custom templates", () => {
    expect(opencodeProviderPresets.map((p) => p.name)).toEqual([
      "302.AI（国内）",
      "302.AI（海外）",
      "Oh My OpenCode",
      "Oh My OpenCode Slim",
    ]);
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

  it("OpenClaw: both 302.AI regions use anthropic-messages", () => {
    expect(openclawProviderPresets.map((p) => p.name)).toEqual([
      "302.AI（国内）",
      "302.AI（海外）",
    ]);
    const [domestic, overseas] = openclawProviderPresets;
    expect(overseas.settingsConfig.baseUrl).toBe("https://api.302.ai");
    expect(domestic.settingsConfig.baseUrl).toBe("https://api.302ai.cn");
    expect(overseas.settingsConfig.api).toBe("anthropic-messages");
    expect(domestic.settingsConfig.api).toBe("anthropic-messages");
  });

  it("Hermes: official + both 302.AI regions", () => {
    expect(hermesProviderPresets.map((p) => p.name)).toEqual([
      "Nous Research",
      "302.AI（国内）",
      "302.AI（海外）",
    ]);
    const overseas = hermesProviderPresets.find(
      (x) => x.name === "302.AI（海外）",
    )!;
    const domestic = hermesProviderPresets.find(
      (x) => x.name === "302.AI（国内）",
    )!;
    expect(overseas.settingsConfig.base_url).toBe("https://api.302.ai/v1");
    expect(domestic.settingsConfig.base_url).toBe(
      "https://api.302ai.cn/v1",
    );
    expect(overseas.settingsConfig.api_mode).toBe("chat_completions");
    expect(domestic.settingsConfig.api_mode).toBe("chat_completions");
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
