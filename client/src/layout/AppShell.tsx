import { useState, useEffect } from "preact/hooks";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CommandPalette } from "../components/CommandPalette";
import { Overview } from "../pages/Overview";
import { Usage } from "../pages/Usage";
import { ClientKeys } from "../pages/ClientKeys";
import { Accounts } from "../pages/Accounts";
import { Models } from "../pages/Models";
import { Aliases } from "../pages/Aliases";
import { Quota } from "../pages/Quota";
import { Settings } from "../pages/Settings";
import { Login } from "../pages/Login";
import { NotFound } from "../pages/NotFound";

const KNOWN_ROUTES = ["overview", "usage", "client-keys", "accounts", "models", "aliases", "quota", "settings"];

function Page({ current }: { current: string }) {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<{ authed: boolean; passwordSet: boolean }>("/api/me"),
    retry: false,
  });
  if (isLoading) return <><TopBar title="Loading…" /><p style={{ padding: 36, color: "var(--text-3)" }}>Loading…</p></>;
  if (me?.passwordSet && !me.authed) return <Login />;
  if (!KNOWN_ROUTES.includes(current)) return <NotFound route={`/admin/${current}`} />;
  switch (current) {
    case "usage": return <Usage />;
    case "client-keys": return <ClientKeys />;
    case "accounts": return <Accounts />;
    case "models": return <Models />;
    case "aliases": return <Aliases />;
    case "quota": return <Quota />;
    case "settings": return <Settings />;
    case "overview": return <Overview />;
    default: return <NotFound route={`/admin/${current}`} />;
  }
}

export function AppShell() {
  const [current, setCurrent] = useState<string>(() => {
    const h = location.hash.replace(/^#\/admin\/?/, "").split("?")[0];
    return h || "overview";
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace(/^#\/admin\/?/, "").split("?")[0];
      setCurrent(h || "overview");
    };
    window.addEventListener("hashchange", onHash);

    const gMap: Record<string, string> = { o: "/admin", u: "/admin/usage", c: "/admin/client-keys", a: "/admin/accounts", m: "/admin/models", l: "/admin/aliases", q: "/admin/quota", s: "/admin/settings" };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setPaletteOpen(true); return; }
      if (e.key === "?" && !inField) { e.preventDefault(); setHelpOpen(true); return; }
      if (e.key === "g" && !inField) {
        e.preventDefault();
        const handler = (ev: KeyboardEvent) => {
          if (gMap[ev.key]) location.hash = gMap[ev.key];
        };
        document.addEventListener("keydown", handler, { once: true });
        setTimeout(() => document.removeEventListener("keydown", handler), 1000);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div class="app-layout">
      <Sidebar current={current} />
      <main class="main">
        <Page current={current} />
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={(href) => { location.hash = href; setPaletteOpen(false); }} />
      {helpOpen && (
        <div class="modal-backdrop" onClick={() => setHelpOpen(false)}>
          <div class="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div class="modal-header"><div class="modal-title">Keyboard shortcuts</div><button class="modal-close" onClick={() => setHelpOpen(false)} aria-label="Close">×</button></div>
            <div class="modal-body" style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <div><kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> — command palette</div>
              <div><kbd>g</kbd> then <kbd>o</kbd> — overview</div>
              <div><kbd>g</kbd> then <kbd>u</kbd> — usage</div>
              <div><kbd>g</kbd> then <kbd>c</kbd> — client keys</div>
              <div><kbd>g</kbd> then <kbd>a</kbd> — accounts</div>
              <div><kbd>g</kbd> then <kbd>m</kbd> — models</div>
              <div><kbd>g</kbd> then <kbd>l</kbd> — aliases</div>
              <div><kbd>g</kbd> then <kbd>q</kbd> — quota</div>
              <div><kbd>g</kbd> then <kbd>s</kbd> — settings</div>
              <div><kbd>?</kbd> — this help</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
