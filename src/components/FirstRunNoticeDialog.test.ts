import { describe, expect, it } from "vitest";
import { buildClaudeDesktopEnterpriseProvider } from "./FirstRunNoticeDialog";

describe("buildClaudeDesktopEnterpriseProvider", () => {
  it("uses local routing for a non-loopback HTTP endpoint", () => {
    const provider = buildClaudeDesktopEnterpriseProvider(
      "http://42.240.172.157:3000",
      "sk-test",
    );

    expect(provider.meta?.claudeDesktopMode).toBe("proxy");
    expect(provider.settingsConfig.env?.ANTHROPIC_BASE_URL).toBe(
      "http://42.240.172.157:3000",
    );
  });

  it("keeps an HTTPS endpoint in direct mode", () => {
    const provider = buildClaudeDesktopEnterpriseProvider(
      "https://gateway.example.com",
      "sk-test",
    );

    expect(provider.meta?.claudeDesktopMode).toBe("direct");
  });
});
