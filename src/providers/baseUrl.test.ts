import { describe, it, expect } from "vitest";
import { getBaseUrl } from "./baseUrl.js";

describe("getBaseUrl", () => {
  const accountIntl = { provider: "minimax" as const, baseUrl: null };
  const accountCn = { provider: "minimax" as const, baseUrl: null };

  it("returns intl OpenAI URL by default", () => {
    const url = getBaseUrl(accountIntl, "openai");
    expect(url).toBe("https://api.minimax.io/v1");
  });

  it("returns intl Anthropic URL by default", () => {
    const url = getBaseUrl(accountIntl, "anthropic");
    expect(url).toBe("https://api.minimax.io/anthropic");
  });

  it("returns CN OpenAI URL when MINIMAX_REGION=cn", () => {
    const prev = process.env.MINIMAX_REGION;
    process.env.MINIMAX_REGION = "cn";
    try {
      const url = getBaseUrl(accountCn, "openai");
      expect(url).toBe("https://api.minimaxi.com/v1");
    } finally {
      process.env.MINIMAX_REGION = prev;
    }
  });

  it("returns CN Anthropic URL when MINIMAX_REGION=cn", () => {
    const prev = process.env.MINIMAX_REGION;
    process.env.MINIMAX_REGION = "cn";
    try {
      const url = getBaseUrl(accountCn, "anthropic");
      expect(url).toBe("https://api.minimaxi.com/anthropic");
    } finally {
      process.env.MINIMAX_REGION = prev;
    }
  });

  it("honors account.baseUrl override", () => {
    const url = getBaseUrl(
      { provider: "minimax" as const, baseUrl: "https://my-proxy.example.com" },
      "openai",
    );
    expect(url).toBe("https://my-proxy.example.com");
  });
});
