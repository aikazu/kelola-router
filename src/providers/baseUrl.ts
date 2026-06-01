type AccountLike = { provider: "minimax"; baseUrl: string | null };

export function getBaseUrl(
  account: AccountLike,
  kind: "openai" | "anthropic",
): string {
  if (account.baseUrl) return account.baseUrl;
  const isCn = process.env.MINIMAX_REGION === "cn";
  if (kind === "openai") {
    return isCn ? "https://api.minimaxi.com/v1" : "https://api.minimax.io/v1";
  }
  return isCn ? "https://api.minimaxi.com/anthropic" : "https://api.minimax.io/anthropic";
}