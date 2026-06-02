import { useState } from "preact/hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api";
import { Button } from "../components/Button";
import { useToast } from "../components/ToastProvider";

export function Login() {
  const [pw, setPw] = useState("");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const loginMut = useMutation({
    mutationFn: (password: string) => apiFetch<{ authed: boolean }>("/api/login", { method: "POST", json: { password } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      location.hash = "/admin";
    },
    onError: (e: unknown) => {
      const err = e as ApiError;
      const msg = err.retryAfterMs
        ? `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(err.retryAfterMs / 1000)} detik.`
        : "Password salah.";
      setErrMsg(msg);
      toast.error(msg);
    },
  });

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--ink-0)" }}>
      <form
        onSubmit={(e) => { e.preventDefault(); setErrMsg(null); loginMut.mutate(pw); }}
        style={{ background: "var(--ink-1)", border: "1px solid var(--emerald-2)", borderRadius: 8, padding: 36, width: 360, boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
      >
        <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 500, textAlign: "center", marginBottom: 4 }}>
          <span style={{ color: "var(--emerald-4)" }}>k</span>elola-router
        </div>
        <div style={{ textAlign: "center", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "var(--gold-2)", marginBottom: 24 }}>
          Restricted access
        </div>
        {errMsg && (
          <div role="alert" aria-live="assertive" id="login-error" style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12, padding: 8, background: "rgba(192,57,43,0.1)", borderRadius: 4 }}>
            {errMsg}
          </div>
        )}
        <label htmlFor="login-password" style={{ display: "block", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--gold-2)", marginBottom: 6 }}>
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={pw}
          onInput={(e) => setPw((e.target as HTMLInputElement).value)}
          aria-label="Password"
          aria-invalid={!!errMsg}
          aria-describedby={errMsg ? "login-error" : undefined}
          autoFocus
          required
          style={{ width: "100%", padding: "10px 12px", background: "var(--ink-2)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, marginBottom: 12, fontFamily: "inherit", fontSize: 14 }}
        />
        <Button type="submit" disabled={!pw || loginMut.isPending} style={{ width: "100%" }}>
          {loginMut.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
