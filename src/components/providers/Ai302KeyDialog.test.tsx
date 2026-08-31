import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ai302KeyDialog } from "./Ai302KeyDialog";
import { settingsApi } from "@/lib/api";
import type { Provider } from "@/types";

const mocks = vi.hoisted(() => ({
  fetchModels: vi.fn(),
  authorizedKey: undefined as undefined | ((key: string) => void),
  discard: vi.fn(),
}));

vi.mock("@/lib/api/model-fetch", () => ({
  fetchModelsForConfig: mocks.fetchModels,
  probeChatKey: vi.fn(),
}));

vi.mock("@/hooks/useEnterpriseApiKeyAuthorization", () => ({
  useEnterpriseApiKeyAuthorization: (
    _owner: string,
    onApiKey: (key: string) => void,
  ) => {
    mocks.authorizedKey = onApiKey;
    return {
      status: "idle",
      start: vi.fn(),
      cancel: vi.fn(),
      reset: vi.fn(),
      discard: mocks.discard,
    };
  },
}));

const provider: Provider = {
  id: "enterprise-provider",
  name: "Enterprise",
  websiteUrl: "https://enterprise.example.com",
  category: "third_party",
  settingsConfig: {
    env: {
      ANTHROPIC_BASE_URL: "https://enterprise.example.com",
      ANTHROPIC_API_KEY: "original-key",
    },
  },
};

describe("Ai302KeyDialog enterprise authorization", () => {
  beforeEach(() => {
    mocks.fetchModels.mockReset();
    mocks.discard.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the domestic site when editing a domestic node", () => {
    const openExternal = vi
      .spyOn(settingsApi, "openExternal")
      .mockResolvedValue();
    render(
      <Ai302KeyDialog
        open
        provider={{
          ...provider,
          id: "ai302-cn-claude",
          settingsConfig: {
            env: {
              ANTHROPIC_BASE_URL: "https://api.302ai.cn",
              ANTHROPIC_API_KEY: "",
            },
          },
        }}
        appId="claude"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "没有 Key？去 302.AI 领取" }),
    );

    expect(openExternal).toHaveBeenCalledWith("https://302ai.cn");
  });

  it("keeps the returned key unsavable when automatic verification fails", async () => {
    mocks.fetchModels.mockRejectedValue(new Error("HTTP 401"));
    const onSubmit = vi.fn();
    render(
      <Ai302KeyDialog
        open
        provider={provider}
        appId="claude"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await act(async () => mocks.authorizedKey?.("returned-key"));
    await waitFor(() => expect(mocks.fetchModels).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the returned key only after automatic verification succeeds", async () => {
    mocks.fetchModels.mockResolvedValue(["model"]);
    const onSubmit = vi.fn();
    render(
      <Ai302KeyDialog
        open
        provider={provider}
        appId="claude"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await act(async () => mocks.authorizedKey?.("returned-key"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(
      onSubmit.mock.calls[0][0].provider.settingsConfig.env.ANTHROPIC_API_KEY,
    ).toBe("returned-key");
  });

  it("requires verification again when the address changes after authorization", async () => {
    mocks.fetchModels.mockResolvedValue(["model"]);
    render(
      <Ai302KeyDialog
        open
        provider={provider}
        appId="claude"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await act(async () => mocks.authorizedKey?.("returned-key"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled(),
    );
    fireEvent.change(document.querySelector("#ai302-base-url")!, {
      target: { value: "https://changed.example.com" },
    });

    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  });

  it("does not submit changes when the dialog is cancelled", () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Ai302KeyDialog
        open
        provider={provider}
        appId="claude"
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(document.querySelector("#ai302-api-key")!, {
      target: { value: "manual-change" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
