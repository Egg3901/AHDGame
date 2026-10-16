/**
 * @vitest-environment happy-dom
 */
/**
 * The organize drive is paid in action points, and a refusal used to render as
 * muted grey text at the bottom of the panel, indistinguishable from "the
 * button did nothing". These pin the affordances that make the refusal
 * legible: the button is disabled with a reason when the player cannot afford
 * it, and a server refusal renders as an error alert. The last case pins the
 * rank-and-file loop itself, that the button is there at all on a union that
 * already has a president.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within, act } from "@testing-library/react";
import UnionPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "u1" }),
}));

const UNION = {
  id: "u1",
  name: "Union of Post Office Workers",
  countryId: "UK",
  countryName: "United Kingdom",
  sectorType: "telecommunications",
  sectorLabel: "Telecommunications",
  ownerId: null as string | null,
  pendingLeaderCharacterId: null,
  electionOpen: false,
  leadershipElectionMinStrength: 100,
  strength: 40,
  organizeActionCost: 5,
  organizeStrengthGain: 10,
  treasury: 100,
  members: 340,
  approval: 55,
  duesPerWorkerAnnual: 0,
  activeServices: [] as string[],
  annualWage: 0,
  demandedWageLevel: null,
  suspended: false,
};

function mockFetch({
  actions,
  organizeStatus,
  union = UNION,
}: {
  actions: number;
  organizeStatus?: number;
  union?: typeof UNION;
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/organize") && init?.method === "POST") {
      return {
        ok: false,
        status: organizeStatus ?? 400,
        json: async () => ({ error: "An organize drive costs 5 action points (you have 0)." }),
      } as unknown as Response;
    }
    if (u.includes("/api/character/me")) {
      return {
        ok: true,
        json: async () => ({ character: { _id: "c1", actions, unionLeaderOf: null } }),
      } as unknown as Response;
    }
    if (u.includes("/leader/vote")) {
      return {
        ok: true,
        json: async () => ({
          tallies: [],
          myVote: null,
          canVote: false,
          organizerCount: 0,
          myVotingPower: 0,
        }),
      } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({ union, sectors: [], endorsements: [] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

// React's `use` reads a thenable synchronously when it is already fulfilled,
// which avoids suspending the whole tree in a test with no RSC boundary.
const PARAMS = {
  status: "fulfilled",
  value: { id: "u1" },
  then: (resolve: (v: { id: string }) => void) => resolve({ id: "u1" }),
} as unknown as Promise<{ id: string }>;

beforeEach(() => vi.restoreAllMocks());

describe("organize drive affordances", () => {
  it("disables the button and says why when the action bar is empty", async () => {
    global.fetch = mockFetch({ actions: 0 });
    render(<UnionPage params={PARAMS} />);

    const btn = await screen.findByRole("button", { name: /run organize drive/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not enough action points/i)).toBeTruthy();
    // The player's own action count is shown next to the cost.
    expect(screen.getByText(/you have 0/i)).toBeTruthy();
  });

  it("offers the drive on a union that already has a president", async () => {
    global.fetch = mockFetch({ actions: 20, union: { ...UNION, ownerId: "someone-else" } });
    render(<UnionPage params={PARAMS} />);

    const btn = await screen.findByRole("button", { name: /run organize drive/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    // The leader-only election panel stays hidden; the rank-and-file panel does not.
    expect(screen.queryByText(/elect a president/i)).toBeNull();
  });

  it("shows the player their own banked voting power", async () => {
    global.fetch = mockFetch({ actions: 20 });
    render(<UnionPage params={PARAMS} />);

    expect(await screen.findByText(/your voting power/i)).toBeTruthy();
  });

  it("surfaces a server refusal as an error alert, not muted body text", async () => {
    global.fetch = mockFetch({ actions: 20 });
    render(<UnionPage params={PARAMS} />);

    const btn = await screen.findByRole("button", { name: /run organize drive/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/action points/i);
      expect(alert.className).toMatch(/text-error/);
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function response(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as Response;
}

const SHOPS = Array.from({ length: 28 }, (_, i) => ({
  sectorId: `s${i}`,
  corporationId: `c${i}`,
  corporationName: `Steel ${String(i).padStart(2, "0")}`,
  stateId: i === 27 ? "OH" : "TX",
  wageLevel: 1,
  workers: 100,
  wageGap: null,
  unionization: 10,
  representingUnionId: i === 26 ? "rival" : "u1",
  strikeActive: false,
  strikeCooldownUntilTurn: null,
  strikeBlockReason: null,
}));

function refreshFetch(raidWon = false) {
  const refresh = deferred<Response>();
  const otherUnion = deferred<Response>();
  let reads = 0;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (url.endsWith("organize-sectors"))
        return response({
          requested: 2,
          completed: 1,
          results: [
            { sectorId: "s0", ok: true },
            { sectorId: "s1", ok: false },
          ],
          stopped: null,
        });
      const { sectorId } = JSON.parse(String(init.body));
      return response({ wasRaid: sectorId === "s26", won: raidWon, unionization: 12.5 });
    }
    if (url === "/api/character/me")
      return response({
        character: {
          _id: "c1",
          unionLeaderOf: "u1",
          actions: 100,
        },
      });
    if (url.endsWith("leader/vote")) return response({});
    if (url === "/api/unions/u2") return otherUnion.promise;
    reads++;
    return reads === 1
      ? response({ union: { ...UNION, treasury: 1_000_000 }, sectors: SHOPS })
      : refresh.promise;
  });
  global.fetch = fetcher as unknown as typeof fetch;
  return { refresh, otherUnion, fetcher };
}

async function openShops() {
  await screen.findByRole("heading", { name: UNION.name });
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", {
      name: /^Sectors/,
    })
  );
  const search = screen.getByLabelText(
    "Filter sectors by corporation or state"
  ) as HTMLInputElement;
  fireEvent.change(search, { target: { value: "TX" } });
  fireEvent.click(screen.getByRole("button", { name: "Corporation" }));
  fireEvent.click(screen.getByRole("button", { name: /^Corporation/ }));
  fireEvent.click(screen.getByRole("button", { name: "Show all 27 shops" }));
  return { search, table: screen.getByRole("table") };
}

describe("dashboard refresh preserves the sectors table", () => {
  it.each(["organize", "won raid", "lost raid", "batch"])(
    "keeps filters, sorting, expansion and selection through %s",
    async (action) => {
      const { refresh, fetcher } = refreshFetch(action === "won raid");
      render(<UnionPage params={PARAMS} />);
      const { search, table } = await openShops();
      fireEvent.click(screen.getByLabelText("Select Steel 00 in TX"));
      fireEvent.click(screen.getByLabelText("Select Steel 01 in TX"));
      if (action === "batch") fireEvent.click(screen.getByRole("button", { name: "Run 2 drives" }));
      else
        fireEvent.click(
          screen.getAllByRole("button", { name: action.includes("raid") ? "Raid" : "Organize" })[0]
        );
      await waitFor(() =>
        expect(
          fetcher.mock.calls.filter(([url, init]) => url === "/api/unions/u1" && !init)
        ).toHaveLength(2)
      );
      // Identity matters: a replacement table also loses the browser's scroll anchor.
      expect(screen.queryByRole("table")).toBe(table);
      expect((screen.getByRole("button", { name: "Raid" }) as HTMLButtonElement).disabled).toBe(
        true
      );
      refresh.resolve(response({ union: { ...UNION, treasury: 999_999 }, sectors: SHOPS }));
      await waitFor(() =>
        expect((screen.getByRole("button", { name: "Raid" }) as HTMLButtonElement).disabled).toBe(
          false
        )
      );
      expect(screen.getByRole("table")).toBe(table);
      expect(search.value).toBe("TX");
      expect(
        screen.getByRole("columnheader", { name: /Corporation/ }).getAttribute("aria-sort")
      ).toBe("descending");
      expect(screen.getAllByRole("row")).toHaveLength(28);
      expect(screen.getByRole("button", { name: "Show the first 25" })).toBeTruthy();
      expect((screen.getByLabelText("Select Steel 01 in TX") as HTMLInputElement).checked).toBe(
        true
      );
      expect((screen.getByLabelText("Select Steel 00 in TX") as HTMLInputElement).checked).toBe(
        action !== "batch"
      );
    }
  );

  it.each(["network", "server", "not found"])(
    "leaves the dashboard accessible with an error after a %s refresh failure",
    async (failure) => {
      const { refresh } = refreshFetch();
      render(<UnionPage params={PARAMS} />);
      const { table } = await openShops();
      fireEvent.click(screen.getByRole("button", { name: "Raid" }));
      if (failure === "network") refresh.reject(new Error("offline"));
      else
        refresh.resolve(
          response({ error: "Refresh unavailable" }, failure === "server" ? 500 : 404)
        );
      await waitFor(() =>
        expect(
          screen
            .getAllByRole("alert")
            .some((alert) => /loading union|Refresh unavailable/i.test(alert.textContent ?? ""))
        ).toBe(true)
      );
      expect(screen.getByRole("table")).toBe(table);
      expect(screen.getByRole("heading", { name: UNION.name })).toBeTruthy();
    }
  );

  it("resets data on a route change and ignores an old union's late refresh", async () => {
    const { refresh, otherUnion } = refreshFetch();
    const view = render(<UnionPage params={PARAMS} />);
    await openShops();
    fireEvent.click(screen.getByRole("button", { name: "Raid" }));
    const params = {
      ...PARAMS,
      status: "fulfilled",
      value: { id: "u2" },
      then: (resolve: (v: { id: string }) => void) => resolve({ id: "u2" }),
    } as unknown as Promise<{ id: string }>;
    view.rerender(<UnionPage params={params} />);
    expect(screen.queryByRole("heading", { name: UNION.name })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    otherUnion.resolve(
      response({ union: { ...UNION, id: "u2", name: "Other union" }, sectors: [] })
    );
    await screen.findByRole("heading", { name: "Other union" });
    await act(async () => {
      refresh.resolve(response({ union: UNION, sectors: SHOPS }));
    });
    await waitFor(() => expect(screen.queryByRole("heading", { name: UNION.name })).toBeNull());
    expect(screen.getByRole("heading", { name: "Other union" })).toBeTruthy();
  });
});
