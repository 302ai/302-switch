import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiKeySection } from "./ApiKeySection";

describe("ApiKeySection", () => {
  it("uses the authorization callback instead of a plain link when provided", () => {
    const onGetApiKey = vi.fn();

    render(
      <ApiKeySection
        value=""
        onChange={vi.fn()}
        category="third_party"
        shouldShowLink
        websiteUrl="https://enterprise.example.com"
        onGetApiKey={onGetApiKey}
      />,
    );

    const button = screen.getByRole("button", {
      name: "获取 API Key",
    });
    fireEvent.click(button);

    expect(onGetApiKey).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("link", { name: "获取 API Key" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the normal API Key page as a link without an authorization callback", () => {
    render(
      <ApiKeySection
        value=""
        onChange={vi.fn()}
        category="aggregator"
        shouldShowLink
        websiteUrl="https://dash.302.ai/apis/list"
      />,
    );

    expect(screen.getByRole("link", { name: "获取 API Key" })).toHaveAttribute(
      "href",
      "https://dash.302.ai/apis/list",
    );
  });
});
