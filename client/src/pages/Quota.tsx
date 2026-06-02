import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { TopBar } from "../layout/TopBar";
import { Progress } from "../components/Progress";
import { Badge } from "../components/Badge";
import { TableSkeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { relativeTime } from "../lib/relativeTime";

interface QuotaWindow { windowType: string; usedCount: number; totalCount: number; remainingCount: number; windowEnd: string | null; fetchedAt: string; }
interface AccountQuota { accountId: string; label: string; creditType: string; enabled: boolean; windows: QuotaWindow[]; }

export function Quota() {
  const { data: quotas = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["quota"],
    queryFn: () => apiFetch<AccountQuota[]>("/api/admin/quota"),
    refetchInterval: 60_000,
  });

  if (isError) return <><TopBar title="Quota" /><ErrorState error={error as Error} onRetry={() => refetch()} /></>;

  return (
    <>
      <TopBar title={<>Quo<em>ta</em></>} eyebrow="Balance / limits" />
      {isLoading ? <><Card><TableSkeleton rows={2} cols={2} /></Card><Card><TableSkeleton rows={2} cols={2} /></Card></> :
       quotas.length === 0 ? <div class="empty"><h3>No accounts</h3><p>Add an upstream account to see quota windows.</p></div> :
       quotas.map(q => {
         const h5 = q.windows.find(w => w.windowType === "5h");
         const wk = q.windows.find(w => w.windowType === "weekly");
         return (
           <Card key={q.accountId} title={q.label} actions={<Badge variant={q.creditType === "token-plan" ? "warn" : "active"}>{q.creditType}</Badge>}>
             {!q.enabled && <p class="card-sub" style={{ color: "var(--warning)" }}>Account disabled</p>}
             {h5 ? <>
               <p class="card-sub">5h window — resets {relativeTime(h5.windowEnd)}</p>
               <Progress value={h5.usedCount} max={h5.totalCount} warn={h5.remainingCount < h5.totalCount * 0.2} />
               <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{h5.usedCount.toLocaleString()} / {h5.totalCount.toLocaleString()} ({h5.remainingCount.toLocaleString()} remaining)</p>
             </> : <p class="card-sub">5h: no data</p>}
             {wk ? <div style={{ marginTop: 16 }}>
               <p class="card-sub">Weekly — resets {relativeTime(wk.windowEnd)}</p>
               <Progress value={wk.usedCount} max={wk.totalCount} warn={wk.remainingCount < wk.totalCount * 0.2} />
               <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{wk.usedCount.toLocaleString()} / {wk.totalCount.toLocaleString()} ({wk.remainingCount.toLocaleString()} remaining)</p>
             </div> : <p class="card-sub" style={{ marginTop: 16 }}>Weekly: no data</p>}
             <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 12 }}>Last fetched {relativeTime(h5?.fetchedAt ?? wk?.fetchedAt ?? null)}</p>
           </Card>
         );
       })}
    </>
  );
}
