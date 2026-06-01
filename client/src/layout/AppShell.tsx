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
import { Quota } from "../pages/Quota";
import { Settings } from "../pages/Settings";
import { Login } from "../pages/Login";

function Page({ current }: { current: string }) {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<{ authed: boolean; passwordSet: boolean }>("/api/me"),
    retry: false,
  });
  if (isLoading) return <><TopBar title="Loading…" /><p style={{ padding: 36, color: "var(--text-3)" }}>Loading…</p></>;
  if (me?.passwordSet && !me.authed) return <Login />;
  switch (current) {
    case "usage": return <Usage />;
    case "client-keys": return <ClientKeys />;
    case "accounts": return <Accounts />;
    case "models": return <Models />;
    case "quota": return <Quota />;
    case "settings": return <Settings />;
    case "overview": default: return <Overview />;
  }
}

export function AppShell() {
  const [current, setCurrent] = useState<string>(() => {
    const h = location.hash.replace(/^#\/admin\/?/, "").split("?")[0];
    return h || "overview";
  });
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace(/^#\/admin\/?/, "").split("?")[0];
      setCurrent(h || "overview");
    };
    window.addEventListener("hashchange", onHash);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === "?" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        alert("Keyboard shortcuts:\n⌘K — command palette\ng+o — overview\ng+u — usage\ng+c — client keys\n? — this help");
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
    </div>
  );
}
