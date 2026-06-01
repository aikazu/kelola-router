import { describe, it, expect, vi, afterEach } from "vitest";
import { proxyAwareFetch } from "./proxyFetch.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("proxyAwareFetch (direct mode)", () => {
  it("calls global fetch with provided url and options", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    const res = await proxyAwareFetch(
      "https://example.com/api",
      { method: "POST", body: "x" },
      { relay: null, proxy: null },
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({ method: "POST", body: "x" }),
    );
  });

  it("returns upstream response unchanged when no relay/proxy", async () => {
    const upstream = new Response('{"a":1}', {
      status: 201,
      headers: { "content-type": "application/json" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
    const res = await proxyAwareFetch(
      "https://example.com",
      {},
      { relay: null, proxy: null },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ a: 1 });
  });
});