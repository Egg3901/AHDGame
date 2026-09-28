/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BankConsoleTab } from "./BankConsoleTab";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === "about") return `About ${values?.label}`;
    if (key === "aboutPosition") return "About position";
    if (key === "tooltips.capFormula") return `${values?.formula}. Now: ${values?.inputs}.`;
    if (key === "tooltips.capFormulaLabel") return `How ${values?.label} is computed`;
    if (key === "pendingDecisions") return `${values?.count} awaiting decision`;
    const messages: Record<string, string> = {
      "eyebrow.ceoControl": "CEO control",
      "eyebrow.monitor": "Monitor",
      "eyebrow.reference": "Reference",
      "eyebrow.supervision": "Supervision",
      position: "Position",
      capitalAttention: "Capital needs attention",
      reservesAttention: "Reserves low",
      needsAttention: "needs attention",
      "actions.postCapital": "Post capital",
      "actions.adjustRates": "Adjust rates",
      "actions.raiseCeiling": "Raise ceiling",
      "actions.manageLoans": "Manage loans",
    };
    return messages[key] ?? key;
  },
}));

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
  primeRate: 2,
  outlook: null,
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

    fireEvent.click(await screen.findByRole("button", { name: "Deposits & Rates" }));
    await screen.findByText("Rates");
    fireEvent.change(screen.getByLabelText("Deposit rate offset"), {
      target: { value: "0.25" },
    });
    fireEvent.change(screen.getByLabelText("Lending rate offset"), {
      target: { value: "1.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save rates" }));

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

    fireEvent.click(await screen.findByRole("button", { name: "Charter" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Charter" }));

    expect(await screen.findByText(/locked for 10 turns \(about 10 hours\)/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Switch to/i })).toBeNull();
  });
});

describe("console hierarchy", () => {
  it("links each overview figure to the tab that moves it", async () => {
    global.fetch = vi.fn(async () => ok(payload)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    fireEvent.click(await screen.findByRole("button", { name: /Post capital/ }));
    await screen.findByText("Capital adequacy");

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(await screen.findByRole("button", { name: /Manage loans/ }));
    await screen.findByText("Loan book");
  });

  it("badges the Lending tab with pending decisions", async () => {
    const withPending = {
      ...payload,
      loans: [
        {
          id: "loan9",
          borrowerType: "character",
          borrower: { id: "char-new", name: "Bo Marsh", sequentialId: 44 },
          principal: 50_000,
          outstanding: 50_000,
          ratePercent: 5,
          originatedTurn: 120,
          termTurns: 12,
          status: "pending",
          arrearsTurns: 0,
        },
      ],
    };
    global.fetch = vi.fn(async () => ok(withPending)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    expect(await screen.findByRole("button", { name: /Lending 1/ })).toBeTruthy();
  });

  it("marks Treasury with the job that needs attention", async () => {
    const reserveShortfall = {
      ...payload,
      charter: { ...payload.charter, cashReserves: 50, requiredReserves: 100 },
    };
    global.fetch = vi.fn(async () => ok(reserveShortfall)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    const treasury = await screen.findByRole("button", { name: /^Treasury/ });
    expect(treasury.getAttribute("title")).toMatch(/Reserves low/);
    expect(treasury.getAttribute("title")).toMatch(/Capital needs attention/);
  });

  it("keeps cap formulas behind tooltips", async () => {
    const withCaps = {
      ...payload,
      caps: [
        {
          key: "bookEquity",
          label: "Book equity",
          formula: "cash + loans out - deposits",
          inputs: [{ label: "Cash", value: 100, unit: "money" }],
          value: 100,
          lever: "Post capital to raise it.",
        },
      ],
    };
    global.fetch = vi.fn(async () => ok(withCaps)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    await screen.findByText("Your limits, and where they come from");
    expect(screen.queryByText(/cash \+ loans out/)).toBeNull();

    fireEvent.click(screen.getByLabelText("How Book equity is computed"));
    await screen.findByText(/cash \+ loans out/);
  });
});

describe("last turn earnings (issue 1748)", () => {
  it("shows interest earned vs paid and the net from the ledgered split", async () => {
    const withEarnings = {
      ...payload,
      charter: {
        ...payload.charter,
        lastBankingIncome: 60,
        lastBankingIncomeTurn: 150,
        lastBankingDepositInterest: 40,
        lastBankingLoanInterest: 120,
        lastBankingInterbankInterestPaid: 0,
        lastBankingInterbankInterestReceived: 10,
        lastBankingFacilityInterest: 5,
        lastBankingInsurancePremium: 15,
        lastBankingWriteoffs: 50,
      },
    };
    global.fetch = vi.fn(async () => ok(withEarnings)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    // Overview tab is the default: earned = 120 + 10, paid = 40 + 0 + 5.
    expect(await screen.findByText("Last turn earnings")).toBeTruthy();
    expect(screen.getByText("Interest earned")).toBeTruthy();
    expect(screen.getByText("Interest paid")).toBeTruthy();
    expect(screen.getByText("Net interest")).toBeTruthy();
    expect(screen.getByText("$130")).toBeTruthy();
    expect(screen.getByText("$45")).toBeTruthy();
    expect(screen.getByText("$85")).toBeTruthy();
    // The detail lines name the ledgered components behind each total.
    expect(screen.getByText(/loans \$120/)).toBeTruthy();
    expect(screen.getByText(/deposits \$40/)).toBeTruthy();
    // Profits are taken via Funding, not as a separate interest withdrawal.
    expect(screen.getByRole("button", { name: "Withdraw in Treasury" })).toBeTruthy();
  });

  it("reads a missing split as zero, never blank", async () => {
    global.fetch = vi.fn(async () => ok(payload)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    expect(await screen.findByText("Last turn earnings")).toBeTruthy();
    expect(screen.getByText("Net interest")).toBeTruthy();
    expect(screen.getAllByText("$0").length).toBeGreaterThan(0);
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

describe("next turn outlook", () => {
  const withOutlook = {
    ...payload,
    householdBook: {
      rows: [],
      total: 0,
      lendingProfile: "balanced",
      blendedRatePercent: null,
      blendedExpectedDefaultPercent: null,
    },
    outlook: {
      primeRate: 2,
      cbSavingsApy: 1,
      depositFlow: 50_000,
      depositDirection: "in",
      targetNpcDeposits: 550_000,
      newLoanDemand: 10_000,
      loanRunoff: 4_000,
      expectedDefaults: 500,
      projectedCash: 600_000,
      projectedRequired: 550_000,
      projectedBand: "green",
      bandReason: null,
      projectedEarnedPerTurn: 900,
      projectedPaidPerTurn: 400,
      projectedPremiumPerTurn: 50,
      projectedNetPerTurn: 500,
      projectedBottomLine: -50,
      netInterestMarginPercent: 2.4,
      costOfFundsPercent: 0.96,
      recommendationKind: "none",
      recommendation: "No action needed: capital clears the 8% minimum.",
      stancePreview: [
        {
          profile: "balanced",
          expectedReturnPerTurn: 100,
          expectedLossPerTurn: 10,
          fundingTied: 50_000,
          turnsToTarget: 5,
        },
      ],
      propLeverage: null,
    },
  };

  it("shows the outlook strip above the position panel", async () => {
    global.fetch = vi.fn(async () => ok(withOutlook)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    expect(await screen.findByText("Next turn outlook")).toBeTruthy();
    expect(screen.getByText("Recommended action")).toBeTruthy();
    expect(screen.getByText(/No action needed/)).toBeTruthy();
    expect(screen.getByText("Net interest margin")).toBeTruthy();
    expect(screen.getByText("Cost of funds")).toBeTruthy();
    expect(screen.getByText("+$50,000")).toBeTruthy();
  });

  it("shows per-stance economics on the lending stance picker", async () => {
    global.fetch = vi.fn(async () => ok(withOutlook)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    fireEvent.click(await screen.findByRole("button", { name: "Lending" }));
    expect(await screen.findByText("Lending stance")).toBeTruthy();
    expect(screen.getByText("Target book")).toBeTruthy();
    expect(screen.getByText("$50,000")).toBeTruthy();
    expect(screen.getByText("5 turns (about 5 hours)")).toBeTruthy();
  });

  it("shows effective rates and the spread beside the sliders", async () => {
    global.fetch = vi.fn(async () => ok(payload)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    fireEvent.click(await screen.findByRole("button", { name: "Deposits & Rates" }));
    // Prime 2 + deposit offset 0 / lending offset 1 from the payload.
    expect(await screen.findByText("You pay 2.00% (prime 2.00% + offset 0.00)")).toBeTruthy();
    expect(screen.getByText("You charge 3.00% (prime 2.00% + offset 1.00)")).toBeTruthy();
    expect(screen.getByText(/spread between them/)).toBeTruthy();
    expect(screen.queryByText(/Regulation Q/)).toBeNull();
    expect(screen.getAllByText(/Legal rate limits/).length).toBeGreaterThan(0);
  });

  it("puts treasury jobs under Treasury and charter governance under Charter", async () => {
    global.fetch = vi.fn(async () => ok(payload)) as unknown as typeof fetch;

    render(<BankConsoleTab corporationId="corp1" isCeo />);

    fireEvent.click(await screen.findByRole("button", { name: /^Treasury/ }));
    expect(await screen.findByText("Capital adequacy")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Overview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Charter" }));
    expect(await screen.findByText("Change charter type")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Trading" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Funding" })).toBeNull();
  });
});
