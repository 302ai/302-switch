import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { settingsApi } from "@/lib/api";
import {
  buildEnterpriseAuthorizationUrl,
  cancelEnterpriseAuthorizationRequest,
  consumeEnterpriseAuthorizationCallback,
  createEnterpriseAuthorizationRequest,
  hasPendingEnterpriseAuthorizationRequest,
  type EnterpriseAuthorizationCallback,
  type EnterpriseAuthorizationOwner,
} from "@/lib/ai302Authorization";

export type EnterpriseAuthorizationStatus =
  | "idle"
  | "waiting"
  | "pageUnavailable"
  | "cancelled"
  | "stateMismatch"
  | "invalidCallback";

export function useEnterpriseApiKeyAuthorization(
  owner: EnterpriseAuthorizationOwner,
  onApiKey: (apiKey: string) => void,
) {
  const [status, setStatus] = useState<EnterpriseAuthorizationStatus>("idle");

  useEffect(() => {
    const unlistenCallback = listen<EnterpriseAuthorizationCallback>(
      "api-key-auth-callback",
      ({ payload }) => {
        const result = consumeEnterpriseAuthorizationCallback(owner, payload);
        if (result.ok) {
          setStatus("idle");
          onApiKey(result.apiKey);
          return;
        }
        if (result.reason === "stateMismatch") setStatus("stateMismatch");
        if (result.reason === "missingFields") setStatus("invalidCallback");
      },
    );
    const unlistenError = listen("api-key-auth-error", () => {
      if (hasPendingEnterpriseAuthorizationRequest(owner)) {
        setStatus("invalidCallback");
      }
    });
    return () => {
      void unlistenCallback.then((dispose) => dispose());
      void unlistenError.then((dispose) => dispose());
    };
  }, [onApiKey, owner]);

  const start = useCallback(
    async (baseUrl: string) => {
      const request = createEnterpriseAuthorizationRequest(owner);
      setStatus("waiting");
      try {
        const deviceName = navigator.platform || "302 Switch Desktop";
        const url = buildEnterpriseAuthorizationUrl(
          baseUrl,
          request.state,
          deviceName,
        );
        await settingsApi.openExternal(url);
      } catch {
        cancelEnterpriseAuthorizationRequest(owner);
        setStatus("pageUnavailable");
      }
    },
    [owner],
  );

  const cancel = useCallback(() => {
    cancelEnterpriseAuthorizationRequest(owner);
    setStatus("cancelled");
  }, [owner]);

  const reset = useCallback(() => setStatus("idle"), []);
  const discard = useCallback(() => {
    cancelEnterpriseAuthorizationRequest(owner);
    setStatus("idle");
  }, [owner]);

  return { status, start, cancel, reset, discard };
}
