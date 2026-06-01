import { describe, it, expect } from "vitest";
import { compressMessages } from "./index.js";

describe("compressMessages", () => {
  it("returns null when body is null", () => {
    expect(compressMessages(null, true)).toBeNull();
  });

  it("returns null when enabled=false", () => {
    expect(compressMessages({ messages: [] }, false)).toBeNull();
  });

  it("returns null when no messages or input", () => {
    expect(compressMessages({ model: "x" }, true)).toBeNull();
  });

  it("compresses OpenAI tool string > 500 bytes with many lines", () => {
    const bigText = Array(300).fill("output line").join("\n");
    const body = { messages: [{ role: "tool", content: bigText }] };
    const stats = compressMessages(body, true);
    expect(stats).not.toBeNull();
    expect(stats!.bytesBefore).toBeGreaterThan(500);
    expect(stats!.bytesAfter).toBeLessThan(stats!.bytesBefore);
    expect(stats!.hits.length).toBeGreaterThan(0);
    expect(body.messages[0].content.length).toBeLessThan(bigText.length);
  });

  it("compresses Anthropic tool_result content block", () => {
    const bigText = Array(300).fill("x").join("\n");
    const body = {
      system: "you are helpful",
      messages: [{ role: "user", content: [{ type: "tool_result", content: bigText }] }],
    };
    const stats = compressMessages(body, true);
    expect(stats).not.toBeNull();
    expect(body.messages[0].content[0].content.length).toBeLessThan(bigText.length);
  });

  it("leaves short tool results alone", () => {
    const body = { messages: [{ role: "tool", content: "short" }] };
    const stats = compressMessages(body, true);
    expect(stats).toBeNull();
  });

  it("leaves error tool_results alone (is_error=true)", () => {
    const bigText = Array(300).fill("x").join("\n");
    const body = { messages: [{ role: "user", content: [{ type: "tool_result", content: bigText, is_error: true }] }] };
    const stats = compressMessages(body, true);
    expect(stats).toBeNull();
  });
});
