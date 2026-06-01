import { describe, it, expect } from "vitest";
import { addDualCacheBreakpoints, augmentRequest } from "./cache-injection.js";

describe("addDualCacheBreakpoints", () => {
  it("no-op for non-Anthropic shape", () => {
    const body: any = { messages: [{ role: "user", content: "hi" }] };
    addDualCacheBreakpoints(body);
    expect(body.messages[0].cache_control).toBeUndefined();
  });

  it("adds marker to last system block (string → array)", () => {
    const body: any = { system: "you are helpful", messages: [] };
    addDualCacheBreakpoints(body);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("adds marker to last system block (array)", () => {
    const body: any = { system: [{ type: "text", text: "a" }, { type: "text", text: "b" }], messages: [] };
    addDualCacheBreakpoints(body);
    expect(body.system[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("adds marker to last assistant tool_use", () => {
    const body: any = {
      system: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "thinking..." }, { type: "tool_use", id: "tu_1", name: "x", input: {} }] },
        { role: "user", content: "ok" },
      ],
    };
    addDualCacheBreakpoints(body);
    const lastAssistant = body.messages[1].content[1];
    expect(lastAssistant.cache_control).toEqual({ type: "ephemeral" });
  });

  it("respects existing markers (does not overwrite)", () => {
    const body: any = {
      system: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }],
      messages: [],
    };
    addDualCacheBreakpoints(body);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("respectCallerMarkers=false forces marker even if some blocks have them", () => {
    const body: any = {
      system: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }, { type: "text", text: "b" }],
      messages: [],
    };
    addDualCacheBreakpoints(body, false);
    expect(body.system[1].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("augmentRequest", () => {
  it("runs caveman first (mutates system), then cache markers (wrap augmented prefix)", async () => {
    const body: any = {
      system: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }],
      messages: [],
    };
    await augmentRequest(body, {
      caveman: { level: "terse" },
      caching: { autoBreakpoints: true, respectCallerMarkers: true },
    });
    expect(body.system.length).toBe(2);
    expect(body.system[1].text).toContain("Be concise");
  });
});