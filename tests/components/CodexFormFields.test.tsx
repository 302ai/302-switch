import { render, screen } from "@testing-library/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { CodexFormFields } from "@/components/providers/forms/CodexFormFields";
import { Form } from "@/components/ui/form";

type CodexFormFieldsProps = ComponentProps<typeof CodexFormFields>;

const FormShell = ({ children }: PropsWithChildren) => {
  const form = useForm();

  return <Form {...form}>{children}</Form>;
};

const renderForm = (overrides: Partial<CodexFormFieldsProps> = {}) => {
  const props: CodexFormFieldsProps = {
    codexApiKey: "",
    onApiKeyChange: vi.fn(),
    category: "third_party",
    shouldShowApiKeyLink: false,
    websiteUrl: "",
    shouldShowSpeedTest: true,
    codexBaseUrl: "https://api.example.com/v1",
    onBaseUrlChange: vi.fn(),
    isFullUrl: false,
    onFullUrlChange: vi.fn(),
    isEndpointModalOpen: false,
    onEndpointModalToggle: vi.fn(),
    autoSelect: false,
    onAutoSelectChange: vi.fn(),
    apiFormat: "openai_responses",
    onApiFormatChange: vi.fn(),
    speedTestEndpoints: [],
    customUserAgent: "",
    onCustomUserAgentChange: vi.fn(),
    localProxyHeadersOverride: "",
    onLocalProxyHeadersOverrideChange: vi.fn(),
    localProxyBodyOverride: "",
    onLocalProxyBodyOverrideChange: vi.fn(),
    ...overrides,
  };

  return render(
    <FormShell>
      <CodexFormFields {...props} />
    </FormShell>,
  );
};

describe("CodexFormFields", () => {
  it("shows the conversation access warning when editing a provider", () => {
    renderForm({ providerId: "custom-provider" });

    expect(
      screen.getByText("不同 Provider 的对话可能无法继续"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Codex 的登录状态可以与 Custom Settings 同时存在/),
    ).toBeInTheDocument();
  });

  it("does not show the conversation access warning when adding a provider", () => {
    renderForm();

    expect(
      screen.queryByText("不同 Provider 的对话可能无法继续"),
    ).not.toBeInTheDocument();
  });
});
