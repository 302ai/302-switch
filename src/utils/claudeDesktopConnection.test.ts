import { describe, expect, it } from "vitest";
import { requiresClaudeDesktopLocalRoute } from "./claudeDesktopConnection";

describe("requiresClaudeDesktopLocalRoute", () => {
  it.each([
    "http://42.240.165.205:3020",
    "http://api.example.com",
    "http://192.168.1.20:8080",
  ])("routes non-loopback HTTP endpoint %s locally", (baseUrl) => {
    expect(requiresClaudeDesktopLocalRoute(baseUrl)).toBe(true);
  });

  it.each([
    "https://api.example.com",
    "http://localhost:3020",
    "http://127.0.0.1:3020",
    "http://127.8.9.10:3020",
    "http://[::1]:3020",
    "not a URL",
    "",
  ])("does not force local routing for %s", (baseUrl) => {
    expect(requiresClaudeDesktopLocalRoute(baseUrl)).toBe(false);
  });
});
