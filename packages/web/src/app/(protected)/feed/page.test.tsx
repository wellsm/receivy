import { currentMonth } from "@receivy/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionApiFetch } from "@/lib/auth/session-fetch";
import FeedPage from "./page";

vi.mock("@/lib/auth/session-fetch", () => ({ sessionApiFetch: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ currentUser: vi.fn().mockResolvedValue({ email: "ana@example.com" }) }));

function calledPath(): string {
  return vi.mocked(sessionApiFetch).mock.calls[0]?.[0] as string;
}

describe("FeedPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(sessionApiFetch).mockResolvedValue([]);
  });

  it("asks the API for the month in the URL", async () => {
    await FeedPage({ searchParams: Promise.resolve({ month: "2026-08" }) });

    expect(calledPath()).toBe("charges?month=2026-08");
  });

  it("falls back to the current month when the URL carries no month", async () => {
    await FeedPage({ searchParams: Promise.resolve({}) });

    expect(calledPath()).toBe(`charges?month=${currentMonth()}`);
  });

  it("ignores a malformed month instead of breaking the render", async () => {
    await FeedPage({ searchParams: Promise.resolve({ month: "2026-13" }) });

    expect(calledPath()).toBe(`charges?month=${currentMonth()}`);
  });
});
