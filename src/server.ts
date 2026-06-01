import { Hono } from "hono";
import { getBaseUrl } from "./providers/baseUrl.js";
import { buildHeaders } from "./providers/headers.js";
import { proxyAwareFetch } from "./transport/proxyFetch.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "openai")}/chat/completions`;
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

app.post("/v1/messages", async (c) => {
  const body = await c.req.json();
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "anthropic")}/v1/messages`;
  const apiKey = process.env.MINIMAX_API_KEY ?? "mm_test";
  const headers = buildHeaders(
    { provider: "minimax", apiKey },
    body.stream === true,
    "anthropic",
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

app.post("/v1/messages/count_tokens", async (c) => {
  const body = await c.req.json();
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "anthropic")}/v1/messages/count_tokens`;
  const apiKey = process.env.MINIMAX_API_KEY ?? "mm_test";
  const resp = await proxyAwareFetch(
    url,
    { method: "POST", headers: buildHeaders({ provider: "minimax", apiKey }, false, "anthropic"), body: JSON.stringify(body) },
    { relay: null, proxy: null },
  );
  return c.body(await resp.text(), resp.status as any, {
    "content-type": resp.headers.get("content-type") ?? "application/json",
  });
});

app.post("/v1/embeddings", async (c) => {
  const body = await c.req.json();
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "openai")}/embeddings`;
  const apiKey = process.env.MINIMAX_API_KEY ?? "mm_test";
  const resp = await proxyAwareFetch(
    url,
    { method: "POST", headers: buildHeaders({ provider: "minimax", apiKey }, false, "openai"), body: JSON.stringify(body) },
    { relay: null, proxy: null },
  );
  return c.body(await resp.text(), resp.status as any, {
    "content-type": resp.headers.get("content-type") ?? "application/json",
  });
});

app.get("/v1/models", async (c) => {
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "openai")}/models`;
  const apiKey = process.env.MINIMAX_API_KEY ?? "mm_test";
  const resp = await proxyAwareFetch(
    url,
    { method: "GET", headers: buildHeaders({ provider: "minimax", apiKey }, false, "openai") },
    { relay: null, proxy: null },
  );
  return c.body(await resp.text(), resp.status as any, {
    "content-type": resp.headers.get("content-type") ?? "application/json",
  });
});

export { app };