import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEnterpriseAuthorizationUrl,
  consumeEnterpriseAuthorizationCallback,
  createEnterpriseAuthorizationRequest,
  hasPendingEnterpriseAuthorizationRequest,
  resetEnterpriseAuthorizationRequestsForTest,
} from "./ai302Authorization";

describe("enterprise desktop authorization", () => {
  beforeEach(() => resetEnterpriseAuthorizationRequestsForTest());

  it("builds the fixed authorization page under the normalized enterprise root", () => {
    const url = buildEnterpriseAuthorizationUrl(
      "https://enterprise.example.com/v1/",
      "state-value",
      "MacBook Pro",
    );

    expect(url).toBe(
      "https://enterprise.example.com/console/302-switch?state=state-value&device_name=MacBook+Pro",
    );
  });

  it("allows enterprise HTTP deployments and rejects non-web protocols", () => {
    expect(() =>
      buildEnterpriseAuthorizationUrl("http://localhost:3000", "state", "Mac"),
    ).not.toThrow();
    expect(
      buildEnterpriseAuthorizationUrl(
        "http://42.240.172.157:3000",
        "state",
        "Mac",
      ),
    ).toBe(
      "http://42.240.172.157:3000/console/302-switch?state=state&device_name=Mac",
    );
    expect(() =>
      buildEnterpriseAuthorizationUrl("file:///tmp/auth", "state", "Mac"),
    ).toThrow("HTTP");
  });

  it("consumes a matching callback once without exposing values in errors", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(7),
    });
    const request = createEnterpriseAuthorizationRequest("onboarding");
    expect(hasPendingEnterpriseAuthorizationRequest("onboarding")).toBe(true);
    expect(hasPendingEnterpriseAuthorizationRequest("editor")).toBe(false);

    expect(
      consumeEnterpriseAuthorizationCallback("onboarding", {
        state: request.state,
        apiKey: "secret-key",
      }),
    ).toEqual({ ok: true, apiKey: "secret-key" });
    expect(hasPendingEnterpriseAuthorizationRequest("onboarding")).toBe(false);
    expect(
      consumeEnterpriseAuthorizationCallback("onboarding", {
        state: request.state,
        apiKey: "secret-key",
      }),
    ).toEqual({ ok: false, reason: "expired" });
    vi.unstubAllGlobals();
  });

  it("rejects missing fields and mismatched state without consuming the request", () => {
    const request = createEnterpriseAuthorizationRequest("editor");

    expect(
      consumeEnterpriseAuthorizationCallback("editor", {
        state: "wrong-state",
        apiKey: "secret-key",
      }),
    ).toEqual({ ok: false, reason: "stateMismatch" });
    expect(
      consumeEnterpriseAuthorizationCallback("editor", {
        state: request.state,
      }),
    ).toEqual({ ok: false, reason: "missingFields" });
    expect(
      consumeEnterpriseAuthorizationCallback("editor", {
        state: request.state,
        apiKey: "secret-key",
      }),
    ).toEqual({ ok: true, apiKey: "secret-key" });
  });
});
