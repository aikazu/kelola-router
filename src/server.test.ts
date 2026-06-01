import { describe, it, expect, vi, afterEach } from "vitest";
import { app } from "./server.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});

describe("POST /v1/chat/completions", () => {
  it("forwards body to upstream OpenAI URL and returns response", async () => {
    const upstreamBody = JSON.stringify({
      id: "cmpl-1",
      choices: [{ message: { role: "assistant", content: "hi" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "MiniMax-M3",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const res = await app.request(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].message.content).toBe("hi");

    expect(spy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = spy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://api.minimax.io/v1/chat/completions");
    expect(calledOpts.method).toBe("POST");
    const headers = calledOpts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${process.env.MINIMAX_API_KEY}`);
    const sentBody = JSON.parse(calledOpts.body as string);
    expect(sentBody.model).toBe("MiniMax-M3");
  });
});

describe("POST /v1/messages", () => {
  it("forwards to anthropic URL with x-api-key", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"id":"msg_1","content":[{"type":"text","text":"hi"}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "MiniMax-M3",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const [calledUrl, calledOpts] = spy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://api.minimax.io/anthropic/v1/messages");
    const headers = calledOpts.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("mm_test_key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });
});