export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — minimax-router</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 0; padding: 0; background: #f5f5f5; color: #222; }
  nav { background: #222; color: #fff; padding: 12px 24px; }
  nav a { color: #fff; margin-right: 16px; text-decoration: none; }
  main { max-width: 960px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 24px; }
  h2 { font-size: 18px; margin-top: 24px; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #fafafa; font-weight: 600; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .badge.active { background: #d4edda; color: #155724; }
  .badge.error { background: #f8d7da; color: #721c24; }
  .badge.disabled { background: #e2e3e5; color: #383d41; }
  form { background: #fff; padding: 16px; border-radius: 4px; margin-top: 16px; }
  input, select { padding: 6px 10px; margin: 4px 0; border: 1px solid #ddd; border-radius: 4px; }
  button { padding: 6px 14px; background: #007bff; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  label { display: block; margin-top: 8px; }
</style>
</head>
<body>
<nav>
  <a href="/admin">Overview</a>
  <a href="/admin/usage">Usage</a>
  <a href="/admin/accounts">Accounts</a>
  <a href="/admin/models">Models</a>
  <a href="/admin/quota">Quota</a>
  <a href="/admin/settings">Settings</a>
</nav>
<main>
${body}
</main>
</body>
</html>`;
}