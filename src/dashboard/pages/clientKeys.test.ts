import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../../db/index.js";
import { createClientKey, genClientKey } from "../../db/repos/client_keys.js";
import { renderClientKeys } from "./clientKeys.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "ck-")), "t.db");
});

describe("renderClientKeys", () => {
  it("renders a Copy button for each key", () => {
    const db = openDb();
    const k = createClientKey(db, { label: "my-app", key: genClientKey() });
    const html = renderClientKeys(db);
    expect(html).toContain(">Copy<");
    expect(html).toContain(`copyKey(${k.id}`);
  });

  it("visible cell shows the masked form, not the full key", () => {
    const db = openDb();
    const full = genClientKey();
    createClientKey(db, { label: "my-app", key: full });
    const html = renderClientKeys(db);
    const cell = html.match(/<code id="k\d+">([^<]*)<\/code>/)?.[1] ?? "";
    expect(cell).toBe(`${full.slice(0, 8)}••••••••••••••${full.slice(-4)}`);
    // Middle portion is masked, not present in the visible cell.
    expect(cell).not.toContain(full.slice(8, -4));
  });
});

