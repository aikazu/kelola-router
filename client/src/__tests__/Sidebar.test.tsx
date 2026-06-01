import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "../layout/Sidebar";

function wrap(ui: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Sidebar", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("renders brand and nav items", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ authed: true, passwordSet: false }), { status: 200 }));
    wrap(<Sidebar current="overview" />);
    expect(screen.getByText("kelola-router")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText("Client keys")).toBeInTheDocument();
    expect(screen.getByText("Upstream")).toBeInTheDocument();
    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(screen.getByText("Quota")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("marks current item as active", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ authed: true, passwordSet: false }), { status: 200 }));
    wrap(<Sidebar current="usage" />);
    const usageLink = screen.getByText("Usage").closest("a")!;
    expect(usageLink.className).toContain("active");
  });
});
