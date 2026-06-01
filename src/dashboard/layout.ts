import { OBSIDIAN_GOLD_CSS } from "./theme.js";
import { isPasswordSet } from "../auth/password.js";
import type Database from "better-sqlite3";

export type NavKey = "overview" | "usage" | "accounts" | "client-keys" | "models" | "quota" | "settings";

const NAV: Array<{ key: NavKey; label: string; href: string }> = [
  { key: "overview",   label: "Overview",     href: "/admin" },
  { key: "usage",      label: "Usage",        href: "/admin/usage" },
  { key: "client-keys",label: "Client keys",  href: "/admin/client-keys" },
  { key: "accounts",   label: "Upstream",     href: "/admin/accounts" },
  { key: "models",     label: "Models",       href: "/admin/models" },
  { key: "quota",      label: "Quota",        href: "/admin/quota" },
  { key: "settings",   label: "Settings",     href: "/admin/settings" },
];

export interface PageOptions {
  db?: Database.Database;
  showLogout?: boolean;
}

export function page(title: string, active: NavKey, body: string, opts: PageOptions = {}): string {
  return layout(title, active, body, opts);
}

function layout(title: string, active: NavKey, body: string, opts: PageOptions): string {
  const passwordSet = opts.db ? isPasswordSet(opts.db) : false;
  const showLogout = opts.showLogout ?? passwordSet;
  const navHtml = NAV.map(n => {
    const cls = n.key === active ? ` class="active"` : "";
    return `<a href="${n.href}"${cls}>${n.label}</a>`;
  }).join("\n        ");
  const logoutHtml = showLogout
    ? `<form method="POST" action="/logout"><button type="submit">Sign out</button></form>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — kelola-router</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${OBSIDIAN_GOLD_CSS}</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">
      kelola-router
      <span class="brand-tag">${passwordSet ? "PROTECTED" : "OPEN MODE"}</span>
    </div>
    <nav class="nav">
      <div class="nav-section">Dashboard</div>
      ${navHtml}
    </nav>
    <div class="user-card">
      <span>v0.9</span>
      ${logoutHtml}
    </div>
  </aside>
  <main>
    <div class="page-header">
      <div>
        <h1 class="page-title">${escapeHtml(title)}</h1>
      </div>
    </div>
    ${body}
  </main>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
