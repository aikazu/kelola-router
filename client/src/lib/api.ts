export class ApiError extends Error {
  code: string;
  status: number;
  retryAfterMs?: number;
  constructor(code: string, message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.code = code;
    this.status = status;
    if (typeof retryAfterMs === "number") this.retryAfterMs = retryAfterMs;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  let body = init?.body;
  if (init?.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, {
    ...init,
    headers,
    body,
    credentials: "include",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const retryAfterMs = typeof data?.retryAfterMs === "number" ? data.retryAfterMs : undefined;
    throw new ApiError(data?.error ?? "unknown", data?.message ?? res.statusText, res.status, retryAfterMs);
  }
  return data as T;
}
