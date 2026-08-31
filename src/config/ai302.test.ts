import { describe, expect, it } from "vitest";
import {
  getAi302ApiKeyUrl,
  getAi302ModelStrategy,
  readAi302ApiKey,
  readAi302BaseUrl,
  writeAi302ApiKey,
} from "./ai302";

describe("ai302 config helpers", () => {
  it("uses the domestic site for the domestic API node", () => {
    expect(getAi302ApiKeyUrl("https://api.302ai.cn/v1")).toBe(
      "https://302ai.cn",
    );
    expect(getAi302ApiKeyUrl("https://API.302AI.CN/v1")).toBe(
      "https://302ai.cn",
    );
  });

  it("keeps the overseas console for the overseas API node", () => {
    expect(getAi302ApiKeyUrl("https://api.302.ai/v1")).toBe(
      "https://dash.302.ai/apis/list",
    );
  });

  it("reads and writes the app-specific API key fields", () => {
    const claude = writeAi302ApiKey(
      "claude",
      { env: { ANTHROPIC_BASE_URL: "https://api.302.ai" } },
      "sk-claude",
    );
    const codex = writeAi302ApiKey("codex", { auth: {} }, "sk-codex");
    const gemini = writeAi302ApiKey("gemini", { env: {} }, "sk-gemini");

    expect(readAi302ApiKey("claude", claude)).toBe("sk-claude");
    expect(readAi302ApiKey("codex", codex)).toBe("sk-codex");
    expect(readAi302ApiKey("gemini", gemini)).toBe("sk-gemini");
  });

  it("migrates Claude Desktop API_KEY configs to AUTH_TOKEN", () => {
    const legacy = {
      env: {
        ANTHROPIC_BASE_URL: "https://api.302.ai",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_API_KEY: "sk-legacy",
      },
    };

    expect(readAi302ApiKey("claude-desktop", legacy)).toBe("sk-legacy");

    const updated = writeAi302ApiKey("claude-desktop", legacy, "sk-updated");
    expect(updated.env).toEqual({
      ANTHROPIC_BASE_URL: "https://api.302.ai",
      ANTHROPIC_AUTH_TOKEN: "sk-updated",
    });
    expect(readAi302ApiKey("claude-desktop", updated)).toBe("sk-updated");
  });

  it("reads and writes additive-app API key fields", () => {
    const opencode = writeAi302ApiKey(
      "opencode",
      { options: { baseURL: "https://api.302ai.cn/v1", apiKey: "" } },
      "sk-opencode",
    );
    const openclaw = writeAi302ApiKey(
      "openclaw",
      { baseUrl: "https://api.302ai.cn", apiKey: "" },
      "sk-openclaw",
    );
    const hermes = writeAi302ApiKey(
      "hermes",
      { base_url: "https://api.302ai.cn/v1", api_key: "" },
      "sk-hermes",
    );

    expect(readAi302ApiKey("opencode", opencode)).toBe("sk-opencode");
    expect(readAi302BaseUrl("opencode", opencode)).toBe(
      "https://api.302ai.cn/v1",
    );
    expect(readAi302ApiKey("openclaw", openclaw)).toBe("sk-openclaw");
    expect(readAi302BaseUrl("openclaw", openclaw)).toBe("https://api.302ai.cn");
    expect(readAi302ApiKey("hermes", hermes)).toBe("sk-hermes");
    expect(readAi302BaseUrl("hermes", hermes)).toBe("https://api.302ai.cn/v1");
  });

  it("prefers a non-empty Claude Desktop AUTH_TOKEN over the legacy field", () => {
    expect(
      readAi302ApiKey("claude-desktop", {
        env: {
          ANTHROPIC_AUTH_TOKEN: "sk-token",
          ANTHROPIC_API_KEY: "sk-api-key",
        },
      }),
    ).toBe("sk-token");
  });

  it("reports Claude passthrough until an explicit role mapping exists", () => {
    expect(
      getAi302ModelStrategy("claude", {
        env: { ANTHROPIC_BASE_URL: "https://api.302.ai" },
      }),
    ).toEqual({ mode: "follow", mappings: [] });

    expect(
      getAi302ModelStrategy("claude", {
        env: {
          ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k2.7-code",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
        },
      }),
    ).toEqual({
      mode: "fixed",
      mappings: [
        { role: "sonnet", model: "kimi-k2.7-code" },
        { role: "opus", model: "deepseek-v4-pro" },
      ],
    });

    expect(
      getAi302ModelStrategy("claude-desktop", {
        env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8" },
      }),
    ).toEqual({
      mode: "fixed",
      mappings: [{ role: "opus", model: "claude-opus-4-8" }],
    });
  });

  it("extracts the fixed model and endpoint from Codex TOML", () => {
    const config = {
      config:
        'model_provider = "custom"\nmodel = "gpt-5.5"\n\n[model_providers.custom]\nbase_url = "https://api.302.ai/v1"',
    };

    expect(readAi302BaseUrl("codex", config)).toBe("https://api.302.ai/v1");
    expect(getAi302ModelStrategy("codex", config)).toEqual({
      mode: "fixed",
      mappings: [{ role: "default", model: "gpt-5.5" }],
    });
  });

  // 302 预设的默认形态：不写 model 行 = 自动路由（跟随 Codex 客户端）
  it("reports Codex auto-routing when no model line is pinned", () => {
    const config = {
      config:
        'model_provider = "custom"\nmodel_reasoning_effort = "high"\n\n[model_providers.custom]\nbase_url = "https://api.302.ai/v1"',
    };

    expect(getAi302ModelStrategy("codex", config)).toEqual({
      mode: "follow",
      mappings: [],
    });
  });
});
