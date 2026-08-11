/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignManagerTab } from "./CampaignManagerTab";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("CampaignManagerTab", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it("does not show an admin-visible campaign as the viewer's campaign", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        campaigns: [
          {
            id: "other-campaign",
            candidateName: "Karl Freitag",
            party: "1",
            partyName: "Democratic Party",
            funds: 180_000_000,
            currencyCode: "USD",
            actions: 750,
            levels: {
              fundraising: 10,
              oppositionResearch: 5,
              groundGame: 5,
              mediaSpending: 5,
            },
            isExact: true,
            isMine: false,
          },
        ],
      }),
    });

    render(<CampaignManagerTab electionId="election-1" />);

    await waitFor(() => {
      expect(screen.queryByText("Loading campaign...")).toBeNull();
    });
    expect(screen.queryByText("Your Campaign")).toBeNull();
    expect(screen.queryByText("Karl Freitag")).toBeNull();
  });

  it("shows the campaign marked as owned by the viewer", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        campaigns: [
          {
            id: "mine",
            candidateName: "Melania Trump",
            party: "2",
            partyName: "Republican Party",
            funds: 44_900_000,
            currencyCode: "USD",
            actions: 178,
            levels: {
              fundraising: 8,
              oppositionResearch: 4,
              groundGame: 5,
              mediaSpending: 5,
            },
            isExact: true,
            isMine: true,
          },
        ],
      }),
    });

    render(<CampaignManagerTab electionId="election-1" />);

    expect(await screen.findByText("Your Campaign")).toBeTruthy();
    expect(screen.getByText("Melania Trump - Republican Party")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Manage Campaign" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/campaign/mine");
  });
});
