import { normalizeAi302RootUrl } from "@/config/ai302";

export const ENTERPRISE_AUTHORIZATION_PATH = "/console/302-switch";

export type EnterpriseAuthorizationOwner = "onboarding" | "editor";

export interface EnterpriseAuthorizationCallback {
  state?: string;
  apiKey?: string;
}

type ConsumeResult =
  | { ok: true; apiKey: string }
  | {
      ok: false;
      reason: "expired" | "missingFields" | "stateMismatch";
    };

const pendingRequests = new Map<EnterpriseAuthorizationOwner, string>();

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function isAllowedAuthorizationRoot(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

export function buildEnterpriseAuthorizationUrl(
  baseUrl: string,
  state: string,
  deviceName: string,
): string {
  const root = new URL(normalizeAi302RootUrl(baseUrl));
  if (!isAllowedAuthorizationRoot(root)) {
    throw new Error("企业授权页面要求 HTTP 或 HTTPS 地址");
  }
  root.pathname = ENTERPRISE_AUTHORIZATION_PATH;
  root.search = new URLSearchParams({
    state,
    device_name: deviceName,
  }).toString();
  root.hash = "";
  return root.toString();
}

export function createEnterpriseAuthorizationRequest(
  owner: EnterpriseAuthorizationOwner,
): { state: string } {
  const state = randomState();
  pendingRequests.set(owner, state);
  return { state };
}

export function cancelEnterpriseAuthorizationRequest(
  owner: EnterpriseAuthorizationOwner,
): void {
  pendingRequests.delete(owner);
}

export function hasPendingEnterpriseAuthorizationRequest(
  owner: EnterpriseAuthorizationOwner,
): boolean {
  return pendingRequests.has(owner);
}

export function consumeEnterpriseAuthorizationCallback(
  owner: EnterpriseAuthorizationOwner,
  callback: EnterpriseAuthorizationCallback,
): ConsumeResult {
  const expectedState = pendingRequests.get(owner);
  if (!expectedState) return { ok: false, reason: "expired" };
  if (!callback.state || !callback.apiKey?.trim()) {
    return { ok: false, reason: "missingFields" };
  }
  if (callback.state !== expectedState) {
    return { ok: false, reason: "stateMismatch" };
  }
  pendingRequests.delete(owner);
  return { ok: true, apiKey: callback.apiKey.trim() };
}

export function resetEnterpriseAuthorizationRequestsForTest(): void {
  pendingRequests.clear();
}
