import { describe, it, expect } from "vitest";
import { page, type PageName } from "./render.js";

describe("page()", () => {
  it("renders content with title", () => {
    const out = page("Hi", "overview", "<p>body</p>");
    expect(out).toContain("<title>Hi — kelola-router</title>");
    expect(out).toContain("<p>body</p>");
  });

  it("marks the active nav link with class=active", () => {
    const out = page("Hi", "usage", "");
    expect(out).toContain(`<a href="/admin/usage" class="active">Usage</a>`);
  });

  it("does not mark inactive links", () => {
    const out = page("Hi", "models", "");
    expect(out).toContain(`<a href="/admin/models" class="active">Models</a>`);
    expect(out).not.toContain(`<a href="/admin/overview" class="active">`);
  });

  it("exports PageName as a string union of all six routes", () => {
    const names: PageName[] = ["overview", "usage", "accounts", "models", "quota", "settings"];
    for (const n of names) expect(page("t", n, "")).toContain("class=\"active\"");
  });
});
