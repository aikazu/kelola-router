import { useState, useEffect } from "preact/hooks";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "../components/CommandPalette";
import { Placeholder } from "../pages/Placeholder";

function Page({ current }: { current: string }) {
  switch (current) {
    case "usage": return <Placeholder name="Usage" />;
    case "client-keys": return <Placeholder name="Client keys" />;
    case "accounts": return <Placeholder name="Upstream accounts" />;
    case "models": return <Placeholder name="Models" />;
    case "quota": return <Placeholder name="Quota" />;
    case "settings": return <Placeholder name="Settings" />;
    case "overview": default: return <Placeholder name="Overview" />;
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
