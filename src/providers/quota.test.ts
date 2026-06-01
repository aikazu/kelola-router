import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { createAccount } from "../db/repos/accounts.js";
import { latestQuotaByAccount } from "../db/repos/quotaSnapshots.js";
import { pullQuota } from "./quota.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "q-")), "t.db");
});

describe("pullQuota", () => {
  it("skips PAYG accounts", async () => {
    const db = openDb();
    const a = createAccount(db, {
      id: "a1",
      label: "L",
      credit_type: "payg",
      api_key: "k",
    });
    const r = await pullQuota(db, a);
    expect(r.ok).toBe(true);
    expect(latestQuotaByAccount(db, "a1").length).toBe(0);
  });

  it("pulls token_plan and computes used = total - remaining (inversion fix)", async () => {
    const db = openDb();
    const a = createAccount(db, {
      id: "a2",
      label: "L",
      credit_type: "token-plan",
      api_key: "k",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          current_interval_total_count: 1500,
          current_interval_usage_count: 1349,
          start_time: Date.now() - 3_600_000,
          end_time: Date.now() + 3_600_000,
          current_weekly_total_count: 50000,
          current_weekly_usage_count: 12000,
          weekly_start_time: Date.now() - 86_400_000,
          weekly_end_time: Date.now() + 6 * 86_400_000,
        }),
        { status: 200 },
      ),
    );
    const r = await pullQuota(db, a);
    expect(r.ok).toBe(true);
    const snaps = latestQuotaByAccount(db, "a2");
    expect(snaps.length).toBe(2);
    const h5 = snaps.find((s) => s.window_type === "5h")!;
    expect(h5.total_count).toBe(1500);
    expect(h5.remaining_count).toBe(1349);
    expect(h5.used_count).toBe(151);
  });

  it("falls back to coding_plan when token_plan fails", async () => {
    const db = openDb();
    const a = createAccount(db, {
      id: "a3",
      label: "L",
      credit_type: "token-plan",
      api_key: "k",
    });
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(new Response("err", { status: 500 }));
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model_remains: [
            {
              model_name: "MiniMax-M*",
              current_interval_total_count: 100,
              current_interval_usage_count: 80,
              start_time: 0,
              end_time: 0,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const r = await pullQuota(db, a);
    expect(r.ok).toBe(true);
    expect((spy.mock.calls as unknown as Array<[string]>)[1][0]).toContain(
      "coding_plan/remains",
    );
  });
});