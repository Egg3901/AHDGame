/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { StatePartyHQ } from "./StatePartyHQ";

const ROWS = [
  {
    regionId: "CA",
    name: "California",
    organization: 70,
    politicalStrength: 40,
    treasury: 500000,
    registrationPct: 55,
    lean: -4,
    chairName: "Ada",
    nppCount: 3,
    isTarget: false,
    hasPresence: true,
  },
  {
    regionId: "WY",
    name: "Wyoming",
    organization: 15,
    politicalStrength: 80,
    treasury: 1000000,
    registrationPct: 20,
    lean: 6,
    chairName: null,
    nppCount: 0,
    isTarget: false,
    hasPresence: false,
  },
];

afterEach(() => vi.restoreAllMocks());

function setup(over?: Partial<React.ComponentProps<typeof StatePartyHQ>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (typeof input === "string" && input.includes("/state-parties")) {
        return { json: async () => ({ rows: ROWS }) };
      }
      return { json: async () => ({}) };
    })
  );
  render(
    <ToastProvider>
      <StatePartyHQ
        countryId="US"
        partyId="9"
        partyColor="#2563eb"
        canManage
        canSpendPs
        nationalPoliticalStrength={12.5}
        {...over}
      />
    </ToastProvider>
  );
}

describe("StatePartyHQ", () => {
  it("renders aggregate tiles and a table row per region", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("California")).toBeTruthy());
    expect(screen.getByText("Wyoming")).toBeTruthy();
    expect(screen.getByText("Total treasury")).toBeTruthy();
    expect(screen.getByText("State PS (sum)")).toBeTruthy();
    expect(screen.getByText("National PS")).toBeTruthy();
    expect(screen.getByText("12.5")).toBeTruthy();
  });

  it("shows the bulk bar with Build Org when rows are selected (chair)", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("California")).toBeTruthy());
    const caRow = screen.getByText("California").closest("tr")!;
    fireEvent.click(within(caRow).getByLabelText("Select California"));
    expect(screen.getByText(/1 states/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Build Org" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Contest" })).toBeNull();
  });

  it("labels bulk Build Org as national PS and blocks when the national reserve is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (typeof input === "string" && input.includes("/state-parties")) {
          return { json: async () => ({ rows: ROWS }) };
        }
        if (typeof input === "string" && input.includes("/build-org/preview")) {
          return {
            json: async () => ({
              ok: true,
              effectiveCost: 5,
              projectedGain: 1.2,
              scope: "national-targeted",
            }),
          };
        }
        return { json: async () => ({}) };
      })
    );
    render(
      <ToastProvider>
        <StatePartyHQ
          countryId="US"
          partyId="9"
          partyColor="#2563eb"
          canManage
          canSpendPs
          nationalPoliticalStrength={2}
        />
      </ToastProvider>
    );
    await waitFor(() => expect(screen.getByText("California")).toBeTruthy());
    const caRow = screen.getByText("California").closest("tr")!;
    fireEvent.click(within(caRow).getByLabelText("Select California"));
    fireEvent.click(screen.getByRole("button", { name: "Build Org" }));
    await waitFor(() => expect(screen.getByText(/Insufficient national PS/)).toBeTruthy());
    expect(
      (screen.getByRole("button", { name: /Confirm \(5 Nat'l PS\)/ }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  // Bulk Build Org bills the national treasury once per selected state, so the
  // cash — not the per-state PS ladder — is what scales with the selection.
  // Without a pre-flight check the run half-completes and the rest come back
  // refused, after the estimate promised the full Org total.
  function setupBulk(over?: Partial<React.ComponentProps<typeof StatePartyHQ>>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (typeof input === "string" && input.includes("/state-parties")) {
          return { json: async () => ({ rows: ROWS }) };
        }
        if (typeof input === "string" && input.includes("/build-org/preview")) {
          return {
            json: async () => ({
              ok: true,
              effectiveCost: 5,
              projectedGain: 1.2,
              cashPrice: 45_000,
              scope: "national-targeted",
            }),
          };
        }
        return { json: async () => ({}) };
      })
    );
    render(
      <ToastProvider>
        <StatePartyHQ
          countryId="US"
          partyId="9"
          partyColor="#2563eb"
          canManage
          canSpendPs
          nationalPoliticalStrength={500}
          {...over}
        />
      </ToastProvider>
    );
  }

  async function selectCaliforniaAndOpenBulk() {
    await waitFor(() => expect(screen.getByText("California")).toBeTruthy());
    const caRow = screen.getByText("California").closest("tr")!;
    fireEvent.click(within(caRow).getByLabelText("Select California"));
    fireEvent.click(screen.getByRole("button", { name: "Build Org" }));
  }

  it("totals the cash price of a bulk selection alongside the PS", async () => {
    setupBulk({ nationalTreasury: 5_000_000 });
    await selectCaliforniaAndOpenBulk();
    await waitFor(() => expect(screen.getAllByText(/\$45K/).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /Confirm \(5 Nat'l PS · \$45K\)/ })).toBeTruthy();
  });

  it("blocks a bulk run the national treasury cannot cover", async () => {
    setupBulk({ nationalTreasury: 1_000 });
    await selectCaliforniaAndOpenBulk();
    await waitFor(() => expect(screen.getByText(/Insufficient national funds/)).toBeTruthy());
    const confirm = screen.getByRole("button", {
      name: /Confirm \(5 Nat'l PS · \$45K\)/,
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("allows a bulk run the treasury can cover", async () => {
    setupBulk({ nationalTreasury: 5_000_000 });
    await selectCaliforniaAndOpenBulk();
    await waitFor(() => expect(screen.getAllByText(/\$45K/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Insufficient national funds/)).toBeNull();
    const confirm = screen.getByRole("button", {
      name: /Confirm \(5 Nat'l PS · \$45K\)/,
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });

  it("does not block the run when the treasury is not known to this surface", async () => {
    // A caller that omits `nationalTreasury` should get the pre-cash behaviour,
    // not a button permanently disabled by treating "unknown" as "empty".
    setupBulk();
    await selectCaliforniaAndOpenBulk();
    await waitFor(() => expect(screen.getAllByText(/\$45K/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Insufficient national funds/)).toBeNull();
    const confirm = screen.getByRole("button", {
      name: /Confirm \(5 Nat'l PS · \$45K\)/,
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });

  it("hides Build Org when the viewer cannot spend PS", async () => {
    setup({ canSpendPs: false });
    await waitFor(() => expect(screen.getByText("California")).toBeTruthy());
    const caRow = screen.getByText("California").closest("tr")!;
    fireEvent.click(within(caRow).getByLabelText("Select California"));
    expect(screen.queryByRole("button", { name: "Build Org" })).toBeNull();
  });
});
