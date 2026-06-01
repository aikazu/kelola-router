/**
 * Obsidian-Gold theme system.
 *
 * Deep obsidian black backgrounds with warm antique-gold accents.
 * Cormorant Garamond serif for display, Manrope sans for body.
 * Inspired by private banking, art deco, premium spirits branding.
 *
 * Variable use: every color/spacing/font is a CSS var so individual pages
 * can override or theme without re-declaring.
 */
export const OBSIDIAN_GOLD_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  /* Surfaces — deep obsidian with warm undertones */
  --ink-0:  #0a0908;
  --ink-1:  #14110f;
  --ink-2:  #1c1814;
  --ink-3:  #2a2520;
  --ink-4:  #3a342c;

  /* Gold — antique, not gaudy */
  --gold-0: #6b5418;
  --gold-1: #b8860b;
  --gold-2: #d4af37;
  --gold-3: #f4d03f;
  --gold-4: #f9e29c;

  /* Text */
  --text-1: #f5f0e6;
  --text-2: #a8a098;
  --text-3: #6a6660;
  --text-inv: #14110f;

  /* Semantic */
  --danger:  #c0392b;
  --success: #4a7c3a;
  --warning: #b8860b;

  /* Effects */
  --gold-glow: rgba(212, 175, 55, 0.18);
  --gold-glow-soft: rgba(212, 175, 55, 0.08);
  --border: 1px solid rgba(212, 175, 55, 0.18);
  --border-strong: 1px solid rgba(212, 175, 55, 0.35);

  /* Type */
  --font-display: 'Cormorant Garamond', Georgia, 'Times New Roman', serif;
  --font-body:    'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono:    'JetBrains Mono', 'SF Mono', Menlo, monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  background: var(--ink-1);
  color: var(--text-1);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  background:
    radial-gradient(ellipse 1200px 800px at 50% -10%, rgba(212, 175, 55, 0.04) 0%, transparent 60%),
    linear-gradient(180deg, var(--ink-1) 0%, var(--ink-0) 100%);
  min-height: 100vh;
}

a { color: var(--gold-2); text-decoration: none; transition: color 0.15s; }
a:hover { color: var(--gold-3); }

h1, h2, h3, h4 {
  font-family: var(--font-display);
  font-weight: 500;
  letter-spacing: 0.3px;
  color: var(--text-1);
}
h1 { font-size: 30px; }
h2 { font-size: 20px; margin-top: 28px; }
h3 { font-size: 16px; margin-top: 20px; letter-spacing: 0.5px; }
h2::before {
  content: "❖";
  color: var(--gold-2);
  margin-right: 10px;
  font-size: 14px;
  vertical-align: middle;
  opacity: 0.7;
}

code, pre {
  font-family: var(--font-mono);
  font-size: 12.5px;
  background: var(--ink-3);
  border: var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  color: var(--gold-3);
}
pre { padding: 12px; overflow-x: auto; }

hr {
  border: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--gold-2), transparent);
  opacity: 0.3;
  margin: 24px 0;
}

/* Layout shell */
.app {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
}

/* Sidebar */
.sidebar {
  background: linear-gradient(180deg, var(--ink-2) 0%, var(--ink-0) 100%);
  border-right: var(--border);
  padding: 28px 0;
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.brand {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 500;
  padding: 0 24px 24px;
  border-bottom: var(--border);
  letter-spacing: 1px;
  color: var(--text-1);
}
.brand::first-letter { color: var(--gold-2); font-weight: 600; }
.brand-tag {
  display: block;
  font-family: var(--font-body);
  font-size: 9px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--gold-1);
  margin-top: 4px;
  opacity: 0.7;
}

.nav { padding: 16px 0; flex: 1; }
.nav a {
  display: block;
  padding: 10px 24px;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.3px;
  border-left: 2px solid transparent;
  transition: all 0.15s;
}
.nav a:hover { color: var(--text-1); background: rgba(212, 175, 55, 0.04); }
.nav a.active {
  color: var(--gold-3);
  border-left-color: var(--gold-2);
  background: linear-gradient(90deg, rgba(212, 175, 55, 0.08) 0%, transparent 100%);
}
.nav .nav-section {
  padding: 16px 24px 4px;
  font-size: 9px;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: var(--text-3);
  font-weight: 600;
}

.user-card {
  padding: 16px 20px;
  border-top: var(--border);
  font-size: 11px;
  color: var(--text-2);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.user-card form { display: inline; }
.user-card button {
  background: none;
  border: 0;
  color: var(--text-3);
  font: inherit;
  cursor: pointer;
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  padding: 4px 0;
}
.user-card button:hover { color: var(--gold-3); }

/* Main */
main {
  padding: 36px 44px;
  max-width: 1100px;
}
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  border-bottom: var(--border);
  padding-bottom: 18px;
  margin-bottom: 28px;
}
.page-title {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 500;
  letter-spacing: 0.5px;
}
.page-title::first-letter { color: var(--gold-2); }
.page-sub {
  color: var(--text-2);
  font-size: 13px;
  margin-top: 4px;
  letter-spacing: 0.3px;
}

/* Cards */
.card {
  background: linear-gradient(180deg, var(--ink-2) 0%, rgba(28, 24, 20, 0.6) 100%);
  border: var(--border);
  border-radius: 4px;
  padding: 22px 24px;
  margin-bottom: 18px;
  position: relative;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.card:hover {
  border-color: rgba(212, 175, 55, 0.3);
  box-shadow: 0 0 0 1px var(--gold-glow-soft);
}
.card-title {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 500;
  margin-bottom: 4px;
  letter-spacing: 0.3px;
}
.card-sub { color: var(--text-2); font-size: 12px; margin-bottom: 14px; }

/* Buttons */
.btn, button.btn {
  display: inline-block;
  background: linear-gradient(180deg, var(--gold-3) 0%, var(--gold-2) 100%);
  color: var(--text-inv);
  border: 0;
  padding: 9px 18px;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  border-radius: 3px;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.15s;
  text-decoration: none;
}
.btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(212, 175, 55, 0.25);
  color: var(--text-inv);
}
.btn:active { transform: translateY(0); }
.btn-ghost {
  background: transparent;
  color: var(--gold-3);
  border: var(--border);
  padding: 9px 18px;
}
.btn-ghost:hover {
  background: var(--gold-glow-soft);
  box-shadow: none;
  color: var(--gold-4);
  transform: none;
}
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { background: #a83224; }

/* Forms */
.form-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.form-field { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 200px; }
label {
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--gold-2);
  font-weight: 600;
}
input[type=text], input[type=password], input[type=number], input[type=url], select, textarea {
  background: var(--ink-1);
  border: 1px solid var(--ink-3);
  color: var(--text-1);
  padding: 10px 12px;
  border-radius: 3px;
  font: inherit;
  font-size: 13px;
  outline: none;
  transition: border 0.15s, box-shadow 0.15s;
  font-family: var(--font-body);
}
input:focus, select:focus, textarea:focus {
  border-color: var(--gold-2);
  box-shadow: 0 0 0 3px var(--gold-glow-soft);
}
input::placeholder, textarea::placeholder { color: var(--text-3); }
input[readonly] { color: var(--text-2); }
input[type=checkbox] {
  width: 16px; height: 16px;
  accent-color: var(--gold-2);
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th, td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.1);
}
th {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--gold-1);
  font-weight: 600;
  background: rgba(0, 0, 0, 0.2);
}
tr:hover td { background: rgba(212, 175, 55, 0.03); }
td.mono, code { font-family: var(--font-mono); font-size: 12px; }

/* Badges */
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 2px;
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  font-weight: 600;
  background: var(--ink-3);
  color: var(--text-2);
  border: 1px solid var(--ink-4);
}
.badge-active, .badge-ok { background: rgba(74, 124, 58, 0.18); color: #8fbf73; border-color: rgba(74, 124, 58, 0.4); }
.badge-error, .badge-bad { background: rgba(192, 57, 43, 0.18); color: #e08a7e; border-color: rgba(192, 57, 43, 0.4); }
.badge-disabled, .badge-muted { background: rgba(106, 102, 96, 0.18); color: var(--text-2); }
.badge-warn, .badge-pending { background: rgba(184, 134, 11, 0.18); color: var(--gold-3); border-color: rgba(184, 134, 11, 0.4); }

/* Stats */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  margin-bottom: 24px;
}
.stat {
  background: var(--ink-2);
  border: var(--border);
  border-radius: 4px;
  padding: 16px 18px;
  position: relative;
  overflow: hidden;
}
.stat::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--gold-2), transparent);
  opacity: 0.5;
}
.stat-label {
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--text-3);
  font-weight: 600;
}
.stat-value {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 500;
  margin-top: 4px;
  color: var(--gold-3);
  letter-spacing: 0.5px;
}
.stat-sub { font-size: 11px; color: var(--text-3); margin-top: 2px; }

/* Alert */
.alert {
  border: var(--border);
  border-left: 3px solid var(--gold-2);
  background: var(--gold-glow-soft);
  padding: 14px 18px;
  border-radius: 0 4px 4px 0;
  margin-bottom: 18px;
  font-size: 13px;
  color: var(--text-1);
}
.alert-danger { border-left-color: var(--danger); background: rgba(192, 57, 43, 0.08); }
.alert-warn { border-left-color: var(--warning); }
.alert a { color: var(--gold-3); text-decoration: underline; text-underline-offset: 3px; }

/* Empty state */
.empty {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-3);
  border: 1px dashed var(--ink-3);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.15);
}
.empty h3 { color: var(--text-2); margin-bottom: 8px; }

/* Rule divider */
.rule {
  display: flex;
  align-items: center;
  gap: 16px;
  color: var(--text-3);
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin: 28px 0;
}
.rule::before, .rule::after {
  content: "";
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.4), transparent);
}
`;
