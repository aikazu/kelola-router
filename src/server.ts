import { Hono } from "hono";
import { getBaseUrl } from "./providers/baseUrl.js";
import { buildHeaders } from "./providers/headers.js";
import { proxyAwareFetch } from "./transport/proxyFetch.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "openai")}/v1/chat/completions`;
  const apiKey = process.env.MINIMAX_API_KEY ?? "mm_test";
  const headers = buildHeaders(
    { provider: "minimax", apiKey },
    body.stream === true,
    "openai",
  );
  const resp = await proxyAwareFetch(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    { relay: null, proxy: null },
  );
  return c.body(await resp.text(), resp.status as any, {
    "content-type": resp.headers.get("content-type") ?? "application/json",
  });
});

export { app };