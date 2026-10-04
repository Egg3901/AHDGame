/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShareHistoryPanel from "./ShareHistoryPanel";

const { useShareHistory } = vi.hoisted(() => ({ useShareHistory: vi.fn() }));

vi.mock("./hooks", () => ({ useShareHistory }));
vi.mock("@/components/time/LocalTime", () => ({ LocalTime: () => <time>Trade date</time> }));

describe("ShareHistoryPanel", () => {
  beforeEach(() => {
    useShareHistory.mockReset();
  });

  it("renders legacy trade rows whose anchor amounts are null", () => {
    useShareHistory.mockReturnValue({
      entries: [
        {
          id: "legacy-trade",
          kind: "market_buy",
          turn: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          shares: 4,
          pricePerShareAnchor: null,
          totalAnchor: null,
          from: null,
          to: { name: "Investor", characterId: "character-1" },
        },
      ],
      total: 1,
      pageCount: 1,
      loading: false,
      error: null,
    });

    render(<ShareHistoryPanel corpId="corp-1" />);

    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  });
});
