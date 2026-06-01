export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type NavKey = "overview" | "usage" | "accounts" | "models" | "quota" | "settings";

export function layout(title: string, body: string, active?: NavKey): string {
  const link = (label: string, href: string, key: NavKey) => {
    const cls = active === key ? ` class="active"` : "";
    return `<a href="${href}"${cls}>${label}</a>`;
  };
  const nav = [
    link("Overview", "/admin", "overview"),
    link("Usage", "/admin/usage", "usage"),
    link("Accounts", "/admin/accounts", "accounts"),
    link("Models", "/admin/models", "models"),
    link("Quota", "/admin/quota", "quota"),
    link("Settings", "/admin/settings", "settings"),
  ].join("\n  ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — kelola-router</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 0; padding: 0; background: #f5f5f5; color: #222; }
  nav { background: #222; color: #fff; padding: 12px 24px; }
  nav a { color: #fff; margin-right: 16px; text-decoration: none; }
  nav a.active { border-bottom: 2px solid #4da3ff; }
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
  ${nav}
</nav>
<main>
${body}
</main>
</body>
</html>`;
}
