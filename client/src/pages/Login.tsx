import { useState } from "preact/hooks";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Button } from "../components/Button";

export function Login() {
  const [pw, setPw] = useState("");
  const loginMut = useMutation({
    mutationFn: (password: string) => apiFetch("/api/login", { method: "POST", json: { password } }),
    onSuccess: () => { location.hash = "/admin"; location.reload(); },
    onError: () => { alert("Wrong password"); },
  });

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--ink-0)" }}>
      <form onSubmit={(e) => { e.preventDefault(); loginMut.mutate(pw); }} style={{ background: "var(--ink-1)", border: "1px solid var(--emerald-2)", borderRadius: 8, padding: 36, width: 360, boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 500, textAlign: "center", marginBottom: 4 }}>
          <span style={{ color: "var(--emerald-4)" }}>k</span>elola-router
        </div>
        <div style={{ textAlign: "center", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "var(--gold-2)", marginBottom: 24 }}>Restricted access</div>
        <input type="password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} placeholder="Password" autoFocus style={{ width: "100%", padding: "10px 12px", background: "var(--ink-2)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, marginBottom: 12, fontFamily: "inherit", fontSize: 14 }} />
        <Button type="submit" disabled={!pw || loginMut.isPending} style={{ width: "100%" }}>{loginMut.isPending ? "Signing in…" : "Sign in"}</Button>
      </form>
    </div>
  );
}
