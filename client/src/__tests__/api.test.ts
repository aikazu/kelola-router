import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch } from "../lib/api";

describe("apiFetch", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns parsed JSON on 2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    );
    const data = await apiFetch("/api/test");
    expect(data).toEqual({ ok: true });
  });

  it("throws ApiError on non-2xx with parsed body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "bad", message: "nope" }), { status: 400 })
    );
    await expect(apiFetch("/api/test")).rejects.toMatchObject({ code: "bad", message: "nope", status: 400 });
  });

  it("includes credentials for cookie auth", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await apiFetch("/api/test");
    const init = spy.mock.calls[0][1];
    expect(init?.credentials).toBe("include");
  });
});
