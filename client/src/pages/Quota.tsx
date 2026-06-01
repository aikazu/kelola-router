import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { TopBar } from "../layout/TopBar";
import { Progress } from "../components/Progress";
import { Badge } from "../components/Badge";

interface AccountQuota { accountId: string; label: string; creditType: string; windows: Array<{ windowType: string; usedCount: number; totalCount: number; remainingCount: number; windowEnd: string | null }>; }

export function Quota() {
  const { data: quotas = [], isLoading } = useQuery({ queryKey: ["quota"], queryFn: () => apiFetch<AccountQuota[]>("/api/admin/quota") });

  return (
    <>
      <TopBar title="Quota" />
      {isLoading && <p style={{ color: "var(--text-3)" }}>Loading…</p>}
      {quotas.length === 0 && !isLoading && <div class="empty"><h3>No accounts</h3><p>Add an upstream account to see quota windows.</p></div>}
      {quotas.map(q => {
        const h5 = q.windows.find(w => w.windowType === "5h");
        const wk = q.windows.find(w => w.windowType === "weekly");
        return (
          <Card key={q.accountId} title={q.label} sub={undefined}>
            <Badge variant={q.creditType === "token-plan" ? "warn" : "active"}>{q.creditType}</Badge>
            {h5 ? <>
              <p class="card-sub" style={{ marginTop: 12 }}>5h window — resets {h5.windowEnd ?? "?"}</p>
              <Progress value={h5.usedCount} max={h5.totalCount} warn={h5.remainingCount < h5.totalCount * 0.2} />
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{h5.usedCount} / {h5.totalCount} ({h5.remainingCount} remaining)</p>
            </> : <p class="card-sub" style={{ marginTop: 12 }}>5h: no data</p>}
            {wk && <div style={{ marginTop: 16 }}>
              <p class="card-sub">Weekly — resets {wk.windowEnd ?? "?"}</p>
              <Progress value={wk.usedCount} max={wk.totalCount} warn={wk.remainingCount < wk.totalCount * 0.2} />
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{wk.usedCount} / {wk.totalCount} ({wk.remainingCount} remaining)</p>
            </div>}
          </Card>
        );
      })}
    </>
  );
}
