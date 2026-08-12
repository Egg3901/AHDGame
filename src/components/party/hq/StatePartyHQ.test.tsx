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
      (screen.getByRole("button", { name: /Confirm \(5 Nat'l PS\)/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("hides Build Org when the viewer cannot spend PS", async () => {
    setup({ canSpendPs: false });
    await waitFor(() => expect(screen.getByText("California")).toBeTruthy());
    const caRow = screen.getByText("California").closest("tr")!;
    fireEvent.click(within(caRow).getByLabelText("Select California"));
    expect(screen.queryByRole("button", { name: "Build Org" })).toBeNull();
  });
});
