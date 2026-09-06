/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The write controls on the intelligence console.
 *
 * These are what the console lacked when the feature shipped, which is why it was
 * unusable: nothing could order an operation, so the pot could never be spent. What
 * is pinned here is the CONTRACT with the three routes (their exact request bodies)
 * and the two refusals that having real money now makes possible.
 *
 * `toBeDisabled` and `toBeInTheDocument` are jest-dom matchers and this repo does
 * not load them, so the assertions read the DOM directly.
 */
const BASE = {
  agency: { tradecraft: 5, counterIntel: 20, foundedTurn: 1, hasDirector: true },
  funding: {
    enactedLine: 8.473e8,
    balance: 20_000_000,
    accrualPerTurn: 1.765e7,
    committedUpkeep: 7.46e6,
    collectionCost: 5.084e6,
    actionCost: 1.525e7,
  },
  turn: 10,
  slotsRemaining: 2,
  networks: [
    {
      targetCountryId: "RU",
      level: 2,
      progress: 10,
      funding: "steady",
      suspicion: 12,
      status: "active",
      cooledUntilTurn: null,
    },
  ],
  coverage: [],
  incidents: [],
};

let serviceView: typeof BASE;

vi.mock("@/lib/observability/fetchJson", () => ({
  fetchJson: vi.fn(async () => structuredClone(serviceView)),
}));

const { default: IntelligenceTab } = await import("./IntelligenceTab");

function renderTab(canAct = true) {
  return render(
    <IntelligenceTab
      countryId={"US" as never}
      positionId="director_of_intelligence"
      currencySymbol="$"
      canAct={canAct}
    />
  );
}

const okFetch = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

/** Network target, network funding, operation target, domain, kind - in DOM order. */
const selects = () => screen.getAllByRole("combobox") as HTMLSelectElement[];
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  serviceView = structuredClone(BASE);
});
afterEach(cleanup);

describe("funding a network", () => {
  it("posts the target and the funding level the route expects", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderTab();
    await screen.findByText("Direct the Service");

    fireEvent.change(selects()[0], { target: { value: "RU" } });
    fireEvent.change(selects()[1], { target: { value: "steady" } });
    fireEvent.click(button(/fund network/i));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/intelligence/network");
    expect(JSON.parse(init.body)).toEqual({ targetCountryId: "RU", funding: "steady" });
  });

  it("will not post without a target", async () => {
    renderTab();
    await screen.findByText("Direct the Service");
    expect(button(/fund network/i).disabled).toBe(true);
  });

  it("never offers the service its own country as a target", async () => {
    renderTab();
    await screen.findByText("Direct the Service");
    const values = [...selects()[0].options].map((o) => o.value);
    expect(values).not.toContain("US");
  });
});

describe("ordering an operation", () => {
  it("posts the four fields the route's schema requires", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderTab();
    await screen.findByText("Direct the Service");

    fireEvent.change(selects()[2], { target: { value: "RU" } });
    fireEvent.change(selects()[3], { target: { value: "military" } });
    fireEvent.change(selects()[4], { target: { value: "collect" } });
    fireEvent.click(button(/run operation/i));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      targetCountryId: "RU",
      domain: "military",
      kind: "collect",
      opType: "assess",
    });
  });

  it("refuses an operation the appropriation cannot cover, and says so", async () => {
    // The whole reason funding exists: an unfunded service can order nothing.
    serviceView.funding = { ...BASE.funding, balance: 0 };
    renderTab();
    await screen.findByText("Direct the Service");
    expect(button(/run operation/i).disabled).toBe(true);
    expect(screen.getByText(/appropriation cannot cover/i)).toBeTruthy();
  });

  it("refuses when the turn's slots are spent", async () => {
    serviceView.slotsRemaining = 0;
    renderTab();
    await screen.findByText("Direct the Service");
    expect(button(/run operation/i).disabled).toBe(true);
    expect(screen.getByText(/slot for this turn is spent/i)).toBeTruthy();
  });
});

describe("counter-intelligence posture", () => {
  it("posts an integer posture", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderTab();
    await screen.findByText("Direct the Service");

    fireEvent.change(screen.getByLabelText(/Posture/), { target: { value: "45" } });
    fireEvent.click(button(/set posture/i));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/intelligence/counter-intel");
    expect(JSON.parse(init.body)).toEqual({ counterIntel: 45 });
  });
});

describe("when an order is refused", () => {
  it("surfaces the server's own message rather than a generic one", async () => {
    // The refusals here are meaningful - a cooling network, a pot that will not
    // stretch - and a director needs to know which one it was.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "That network is still cooling off." }),
      })
    );
    renderTab();
    await screen.findByText("Direct the Service");

    fireEvent.change(selects()[0], { target: { value: "RU" } });
    fireEvent.click(button(/fund network/i));

    expect(await screen.findByText("That network is still cooling off.")).toBeTruthy();
  });
});

describe("when the viewer may read but not act", () => {
  it("renders no controls at all", async () => {
    renderTab(false);
    await screen.findByText("The Service");
    expect(screen.queryByText("Direct the Service")).toBeNull();
    expect(screen.queryByRole("button", { name: /run operation/i })).toBeNull();
  });
});
