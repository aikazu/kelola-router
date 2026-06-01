import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { listModels } from "../db/repos/models.js";
import { fetchModels } from "./listModels.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "lm-")), "t.db");
});

describe("fetchModels", () => {
  it("hits upstream /v1/models and merges new ones", async () => {
    const db = openDb();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          { id: "MiniMax-M3" },
          { id: "MiniMax-newmodel" },
          { id: "MiniMax-another" },
        ],
      }), { status: 200 }),
    );

    const count = await fetchModels(db, "mm_test");
    expect(count).toBe(2); // 2 new (M3 already seeded)

    const all = listModels(db, { includeDisabled: true });
    const names = all.map(m => m.name);
    expect(names).toContain("MiniMax-newmodel");
    expect(names).toContain("MiniMax-another");
    expect(names).toContain("MiniMax-M3"); // still there
  });

  it("updates display_name + family on existing models", async () => {
    const db = openDb();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "MiniMax-M3" }] }), { status: 200 }),
    );
    await fetchModels(db, "mm_test");
    const m = listModels(db, { includeDisabled: true }).find(x => x.name === "MiniMax-M3")!;
    expect(m.source).toBe("fetched");
  });

  it("throws on non-2xx", async () => {
    const db = openDb();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));
    await expect(fetchModels(db, "mm_test")).rejects.toThrow(/fetchModels failed/);
  });
});
