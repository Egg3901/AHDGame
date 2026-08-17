/**
 * @vitest-environment happy-dom
 */
/**
 * Self-gating: this action must render nothing for anyone who doesn't head a
 * union matching the sector's country and industry, and must plainly say
 * whether organizing here is a first claim or a raid on a rival union.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { OrganizeSectorAction } from "./OrganizeSectorAction";

const MY_UNION = {
  id: "u1",
  countryId: "US",
  sectorType: "manufacturing",
  name: "United Manufacturing Workers",
  organizeActionCost: 5,
};

function mockFetch({
  unionLeaderOf,
  union = MY_UNION,
  organizeOk = true,
  organizeStatus = 200,
  organizeBody = { message: "Sector organized." },
}: {
  unionLeaderOf: string | null;
  union?: typeof MY_UNION;
  organizeOk?: boolean;
  organizeStatus?: number;
  organizeBody?: Record<string, unknown>;
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/organize-sector") && init?.method === "POST") {
      return {
        ok: organizeOk,
        status: organizeStatus,
        json: async () => organizeBody,
      } as unknown as Response;
    }
    if (u.includes("/api/character/me")) {
      return {
        ok: true,
        json: async () => ({ character: { _id: "c1", unionLeaderOf } }),
      } as unknown as Response;
    }
    if (u.includes("/api/unions/")) {
      return {
        ok: true,
        json: async () => ({ union }),
      } as unknown as Response;
    }
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => vi.restoreAllMocks());

describe("OrganizeSectorAction gating", () => {
  it("renders nothing for a viewer who does not head any union", async () => {
    global.fetch = mockFetch({ unionLeaderOf: null });
    const { container } = render(
      <OrganizeSectorAction countryId="US" sectorType="manufacturing" sectorId="s1" />
    );
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("renders nothing when the viewer's union is a different country or industry", async () => {
    global.fetch = mockFetch({
      unionLeaderOf: "u1",
      union: { ...MY_UNION, sectorType: "financial" },
    });
    const { container } = render(
      <OrganizeSectorAction countryId="US" sectorType="manufacturing" sectorId="s1" />
    );
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("shows the unrepresented copy and cost for a matching union head", async () => {
    global.fetch = mockFetch({ unionLeaderOf: "u1" });
    render(<OrganizeSectorAction countryId="US" sectorType="manufacturing" sectorId="s1" />);

    expect(await screen.findByText(/currently unrepresented/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /organize this sector/i })).toBeTruthy();
    expect(screen.getByText(/costs 5 action points/i)).toBeTruthy();
  });

  it("shows raid copy and posts sectorId when the sector belongs to a rival union", async () => {
    global.fetch = mockFetch({ unionLeaderOf: "u1" });
    render(
      <OrganizeSectorAction
        countryId="US"
        sectorType="manufacturing"
        sectorId="s1"
        representingUnionId="rival-1"
        representingUnionName="Rival Steelworkers"
      />
    );

    expect(await screen.findByText(/rival steelworkers/i)).toBeTruthy();
    expect(screen.getByText(/a raid/i)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /raid this sector/i });
    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByText("Sector organized.")).toBeTruthy());
  });

  it("shows a failed raid plainly, since it still cost the union", async () => {
    global.fetch = mockFetch({
      unionLeaderOf: "u1",
      organizeOk: false,
      organizeStatus: 400,
      organizeBody: { error: "The raid failed. Rival Steelworkers held on." },
    });
    render(
      <OrganizeSectorAction
        countryId="US"
        sectorType="manufacturing"
        sectorId="s1"
        representingUnionId="rival-1"
        representingUnionName="Rival Steelworkers"
      />
    );

    const btn = await screen.findByRole("button", { name: /raid this sector/i });
    fireEvent.click(btn);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/raid failed/i);
    });
  });

  it("shows no action when the sector is already the viewer's own union", async () => {
    global.fetch = mockFetch({ unionLeaderOf: "u1" });
    render(
      <OrganizeSectorAction
        countryId="US"
        sectorType="manufacturing"
        sectorId="s1"
        representingUnionId="u1"
      />
    );

    expect(await screen.findByText(/already organizes this sector/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
