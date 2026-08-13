/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BankConsoleTab } from "./BankConsoleTab";

const payload = {
  privateBankingEnabled: true,
  bankPropTradingEnabled: false,
  visible: true,
  isCeo: true,
  isAdmin: false,
  isChair: false,
  canMutate: true,
  canRevoke: false,
  corporation: {
    id: "corp1",
    name: "Test Bank",
    liquidCapital: 5_000_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
    ownsFinancial: true,
  },
  currency: "USD",
  legalCharterTypes: ["retail"],
  eligibleTypes: ["retail"],
  eligibilityReasons: [],
  capitalRequirement: 1_000_000,
  corridors: {
    deposit: { minOffset: -1, maxOffset: 1 },
    lending: { minOffset: 0, maxOffset: 3 },
  },
  reserveRatio: 0.1,
  depositCeiling: 10_000_000,
  defaultBranchCapacityShare: 0.5,
  blacklistableFunds: [
    { slug: "fund-old", name: "US Top 25" },
    { slug: "fund-new", name: "Global Chemicals Index" },
  ],
  charter: {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 100,
    postedCapital: 1_000_000,
    depositOffset: 0,
    lendingOffset: 1,
    totalDeposits: 2_000_000,
    totalLoans: 1_000_000,
    npcDeposits: 500_000,
    reserves: 300_000,
    confidence: 80,
    warningBand: "green",
    panicTurns: 0,
    branchCapacityShare: 0.5,
    depositCeiling: 10_000_000,
    interbankDebt: 0,
    cbMarginDebt: 0,
    propBookMarkValue: 0,
    propBook: [],
    blacklist: {
      corporations: [{ id: "corp-old", name: "Old Steel", sequentialId: 7, ticker: "OST" }],
      characters: [{ id: "char-old", name: "Mara Vance", sequentialId: 21 }],
      indexFunds: [{ slug: "fund-old", name: "US Top 25" }],
    },
  },
  rates: { depositRatePercent: 2, lendingRatePercent: 4 },
  loans: [],
  interbankLoans: [],
};

function ok(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

beforeEach(() => vi.restoreAllMocks());

describe("BankConsoleTab state groups", () => {
  it("loads the console and saves both rate offsets together", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? ok({ success: true }) : ok(payload)
    );
    global.fetch = fetchMock as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    fireEvent.click(await screen.findByRole("button", { name: "Lending" }));
    await screen.findByText("Rate offsets");
    fireEvent.change(screen.getByLabelText("Deposit rate offset"), {
      target: { value: "0.25" },
    });
    fireEvent.change(screen.getByLabelText("Lending rate offset"), {
      target: { value: "1.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save offsets" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/corporations/corp1/bank/rates",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ depositOffset: 0.25, lendingOffset: 1.25 }),
        })
      );
    });
  });

  it("renders blacklist entries by name and saves ids, never raw hex", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return ok({ success: true });
      if (String(url).includes("/api/characters/search")) {
        return ok({ results: [{ id: "char-new", name: "Bo Marsh", sequentialId: 44 }] });
      }
      return ok(payload);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    fireEvent.click(await screen.findByRole("button", { name: "Lending" }));
    await screen.findByText("Who this bank refuses");

    // Existing entries read as people and companies, not ObjectIds.
    expect(screen.getByText("Mara Vance")).toBeTruthy();
    expect(screen.getByText("Old Steel (OST)")).toBeTruthy();
    expect(screen.getByText("US Top 25")).toBeTruthy();
    expect(screen.queryByText("char-old")).toBeNull();
    expect(screen.queryByText("corp-old")).toBeNull();

    // Add a player through the name search.
    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "Bo" } });
    const pick = await screen.findByRole("button", { name: /Bo Marsh/ });
    fireEvent.click(pick);

    // Drop the company already on the list.
    fireEvent.click(screen.getByRole("button", { name: "Remove Old Steel (OST)" }));

    fireEvent.click(screen.getByRole("button", { name: "Save blacklist" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/corporations/corp1/bank/blacklist",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            corporationIds: [],
            characterIds: ["char-old", "char-new"],
            indexFundIds: ["fund-old"],
          }),
        })
      );
    });
  });

  it("names loan borrowers instead of printing truncated ids", async () => {
    const withLoan = {
      ...payload,
      loans: [
        {
          id: "loan1",
          borrowerType: "character",
          borrower: { id: "char-old", name: "Mara Vance", sequentialId: 21 },
          principal: 100_000,
          outstanding: 90_000,
          ratePercent: 5,
          originatedTurn: 120,
          termTurns: 12,
          status: "arrears",
          arrearsTurns: 2,
        },
      ],
    };
    global.fetch = vi.fn(async () => ok(withLoan)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    fireEvent.click(await screen.findByRole("button", { name: "Lending" }));
    expect(await screen.findByText("Loan book")).toBeTruthy();
    expect(screen.getAllByText("Mara Vance").length).toBeGreaterThan(0);
    expect(screen.queryByText("char-old")).toBeNull();
  });
});

describe("charter type switch (ticket 1069)", () => {
  it("switches charter type via PATCH from the admin tab, warning about the deposit book", async () => {
    const switchable = {
      ...payload,
      currentTurn: 150,
      legalCharterTypes: ["retail", "investment", "universal"],
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? ok({ success: true, charter: { ...switchable.charter, type: "investment" } })
        : ok(switchable)
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    // Retail bank with deposits switching to investment returns the book: confirm.
    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy as unknown as typeof window.confirm;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    await screen.findByText("Change charter type");

    // Default target is the first non-current legal type (investment).
    fireEvent.click(screen.getByRole("button", { name: /Switch to Investment/i }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/corporations/corp1/bank/charter",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ type: "investment" }),
        })
      );
    });
  });

  it("locks the switch during the cooldown window", async () => {
    const cooling = {
      ...payload,
      currentTurn: 150,
      legalCharterTypes: ["retail", "investment"],
      charter: { ...payload.charter, charterSwitchCooldownUntilTurn: 160 },
    };
    global.fetch = vi.fn(async () => ok(cooling)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));

    expect(await screen.findByText(/locked for 10 more turns/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Switch to/i })).toBeNull();
  });
});

describe("charter issue block reason", () => {
  const unchartered = { ...payload, charter: null };

  it("blames the freeze, not the CEO check, when banking is paused for a CEO", async () => {
    global.fetch = vi.fn(async () =>
      ok({ ...unchartered, privateBankingEnabled: false, canMutate: false })
    ) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    await screen.findByText("Issue bank charter");
    expect(screen.getByText(/you can view this console/i)).toBeTruthy();
    expect(screen.getByText(/bank actions are paused/i)).toBeTruthy();
    expect(screen.queryByText(/only the ceo/i)).toBeNull();
  });

  it("still says only the CEO can charter when the viewer is not the CEO", async () => {
    global.fetch = vi.fn(async () =>
      ok({ ...unchartered, isCeo: false, canMutate: false })
    ) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo={false} />);

    await screen.findByText("Issue bank charter");
    expect(screen.getByText(/only the ceo can issue a charter/i)).toBeTruthy();
  });
});
