import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { getGdpAnchorRate } from "@/lib/currency/gdpAnchorRate";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("./orgMembership", () => ({ tributeMembers: vi.fn() }));
vi.mock("./entityGdp", () => ({ loadGdpUsdMillionsByEntity: vi.fn() }));
vi.mock("./organizationFund", () => ({ getOrganizationFund: vi.fn() }));

const { tributeMembers } = await import("./orgMembership");
const { loadGdpUsdMillionsByEntity } = await import("./entityGdp");
const { getOrganizationFund } = await import("./organizationFund");

/** $1tn a year, expressed the way `loadGdpUsdMillionsByEntity` reports it. */
const ONE_TRILLION_IN_USD_MILLIONS = 1_000_000;
/** The per-turn charge in USD, for a given annual GDP in USD millions. */
const perTurnUsd = (gdpUsdMillions: number, rateAnnual = 0.005) =>
  (gdpUsdMillions * 1_000_000 * rateAnnual) / 48;
/**
 * Resolve a currency normaliser the way the code under test does — through the
 * era-aware resolver at the 1953 preset, not the base config. Computing
 * expectations off the base config would make these tests agree with a bug:
 * Turkey's normaliser differs by a factor of twelve between the two.
 */
const rateOf = (id: string) => getGdpAnchorRate(id as never, "1953-default");
/** Preset the world reports; drives which era's currency normaliser applies. */
const worldPreset = (db: MockDb, preset: string) =>
  db.collection("gameState").findOne.mockResolvedValue({ _id: "current", preset });

describe("chargeOrganizationTribute", () => {
  let db: MockDb;
  let budgetUpdateOne: ReturnType<typeof vi.fn>;
  let fundUpdateOne: ReturnType<typeof vi.fn>;

  /** Treasuries the roll is read from in one query. */
  const treasuries = (rows: object[]) =>
    db.collection("federalBudget").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  /** A treasury large enough to absorb anything these cases charge. */
  const solventTreasury = () => treasuries([{ countryId: "TR", treasuryBalance: 1e15 }]);

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Tribute exists only in a 1953-start world, so that is the default here;
    // the scope cases below override it.
    worldPreset(db, "1953-default");
    budgetUpdateOne = db.collection("federalBudget").updateOne;
    treasuries([]);
    fundUpdateOne = db.collection("organizationFunds").updateOne;
    // NATO's fund sits in USD via the US, whose rate is 1.0, so the fund figure
    // and the USD figure coincide except where a case says otherwise.
    vi.mocked(getOrganizationFund).mockResolvedValue({
      balanceLocal: 0,
      duesRateAnnual: 0.00006,
      currencyCountryId: "US",
    } as never);
    vi.mocked(tributeMembers).mockResolvedValue([]);
    vi.mocked(loadGdpUsdMillionsByEntity).mockResolvedValue(new Map());
  });

  it("debits a payer that has a treasury and credits the fund", async () => {
    vi.mocked(tributeMembers).mockResolvedValue(["TR"]);
    vi.mocked(loadGdpUsdMillionsByEntity).mockResolvedValue(
      new Map([["TR", ONE_TRILLION_IN_USD_MILLIONS]])
    );
    solventTreasury();

    const { chargeOrganizationTribute } = await import("./tribute");
    const result = await chargeOrganizationTribute(db as unknown as Db, "NATO");

    const usd = perTurnUsd(ONE_TRILLION_IN_USD_MILLIONS);
    const debitLocal = Math.round(usd / rateOf("TR"));
    expect(result.payers).toBe(1);
    expect(result.minted).toBe(0);
    expect(result.collectedLocal).toBe(Math.round(usd / rateOf("US")));
    // The payer is billed in its own currency; the fund is credited in the
    // fund's. They are the same money seen from two sides.
    expect(budgetUpdateOne).toHaveBeenCalledWith(
      { countryId: "TR" },
      expect.objectContaining({ $inc: { treasuryBalance: -debitLocal } })
    );
    expect(fundUpdateOne).toHaveBeenCalledWith(
      { organizationId: "NATO" },
      expect.objectContaining({ $inc: { balanceLocal: result.collectedLocal } }),
      { upsert: true }
    );
  });

  it("mints for a macro payer, which has no treasury to debit", async () => {
    vi.mocked(tributeMembers).mockResolvedValue(["JO"]);
    vi.mocked(loadGdpUsdMillionsByEntity).mockResolvedValue(new Map([["JO", 48_000]]));
    treasuries([]);

    const { chargeOrganizationTribute } = await import("./tribute");
    const result = await chargeOrganizationTribute(db as unknown as Db, "NATO");

    const expected = Math.round(perTurnUsd(48_000) / rateOf("US"));
    expect(result.collectedLocal).toBe(expected);
    // Reported, never silent: the game does not simulate this economy, so the
    // money has no source and the caller deserves to see that it was created.
    expect(result.minted).toBe(expected);
    expect(budgetUpdateOne).not.toHaveBeenCalled();
  });

  it("charges a payer that is already in debt, deepening it", async () => {
    // A treasury balance is a SIGNED cash position — negative means national
    // debt, which in 1953 is every priced NATO member (France at -$4.2tn). An
    // earlier solvency floor here meant not one of them ever paid and tribute
    // collected nothing at all. A state meets its obligations by borrowing; the
    // consequences are debt-to-GDP and the credit rating, not an unbilled ally.
    vi.mocked(tributeMembers).mockResolvedValue(["TR"]);
    vi.mocked(loadGdpUsdMillionsByEntity).mockResolvedValue(
      new Map([["TR", ONE_TRILLION_IN_USD_MILLIONS]])
    );
    treasuries([{ countryId: "TR", treasuryBalance: -4_000_000_000 }]);

    const { chargeOrganizationTribute } = await import("./tribute");
    const result = await chargeOrganizationTribute(db as unknown as Db, "NATO");

    const owedLocal = Math.round(perTurnUsd(ONE_TRILLION_IN_USD_MILLIONS) / rateOf("TR"));
    expect(result.payers).toBe(1);
    expect(result.minted).toBe(0); // it has a treasury, so nothing is invented
    expect(budgetUpdateOne).toHaveBeenCalledWith(
      { countryId: "TR" },
      expect.objectContaining({ $inc: { treasuryBalance: -owedLocal } })
    );
  });

  it("charges nothing when every member votes", async () => {
    const { chargeOrganizationTribute } = await import("./tribute");
    const result = await chargeOrganizationTribute(db as unknown as Db, "NATO");
    expect(result).toEqual({ collectedLocal: 0, payers: 0, minted: 0 });
    expect(fundUpdateOne).not.toHaveBeenCalled();
  });

  it("omits a payer with no economic data instead of charging it zero", async () => {
    vi.mocked(tributeMembers).mockResolvedValue(["ZZ"]);
    vi.mocked(loadGdpUsdMillionsByEntity).mockResolvedValue(new Map());

    const { chargeOrganizationTribute } = await import("./tribute");
    const result = await chargeOrganizationTribute(db as unknown as Db, "NATO");
    expect(result).toEqual({ collectedLocal: 0, payers: 0, minted: 0 });
  });

  it("credits the fund in the fund's own currency, not the payer's", async () => {
    vi.mocked(getOrganizationFund).mockResolvedValue({
      balanceLocal: 0,
      duesRateAnnual: 0.00006,
      currencyCountryId: "PL",
    } as never);
    vi.mocked(tributeMembers).mockResolvedValue(["TR"]);
    vi.mocked(loadGdpUsdMillionsByEntity).mockResolvedValue(
      new Map([["TR", ONE_TRILLION_IN_USD_MILLIONS]])
    );
    solventTreasury();

    const { chargeOrganizationTribute } = await import("./tribute");
    const result = await chargeOrganizationTribute(db as unknown as Db, "NATO");

    const usd = perTurnUsd(ONE_TRILLION_IN_USD_MILLIONS);
    expect(rateOf("PL")).not.toBe(1); // guard: the case is only meaningful if it differs
    expect(result.collectedLocal).toBe(Math.round(usd / rateOf("PL")));
  });
  it("normalises currency at the era's rate, not the modern one", async () => {
    // Turkey's stored-GDP normaliser is 0.029 in the base config and 0.357 in
    // 1953 — a factor of twelve. Reading the base config in a 1953 world would
    // debit a twelfth of the right amount, and would put tribute at odds with
    // `chargeOrganizationDues`, which charges the other half of the same roll
    // through the era-aware resolver (refs #3778).
    const { COUNTRY_CONFIGS } = await import("@/lib/constants/countries");
    const baseRate = (COUNTRY_CONFIGS as Record<string, { usdExchangeRate?: number }>).TR
      ?.usdExchangeRate;
    expect(rateOf("TR")).not.toBe(baseRate);

    worldPreset(db, "1953-default");
    vi.mocked(tributeMembers).mockResolvedValue(["TR"]);
    vi.mocked(loadGdpUsdMillionsByEntity).mockResolvedValue(
      new Map([["TR", ONE_TRILLION_IN_USD_MILLIONS]])
    );
    solventTreasury();

    const { chargeOrganizationTribute } = await import("./tribute");
    await chargeOrganizationTribute(db as unknown as Db, "NATO");

    const usd = perTurnUsd(ONE_TRILLION_IN_USD_MILLIONS);
    const era1953Debit = Math.round(usd / getGdpAnchorRate("TR", "1953-default"));
    expect(budgetUpdateOne).toHaveBeenCalledWith(
      { countryId: "TR" },
      expect.objectContaining({ $inc: { treasuryBalance: -era1953Debit } })
    );
  });
  describe("scope", () => {
    /** A roll that WOULD be charged if the organisation and world qualified. */
    const chargeablePayer = () => {
      vi.mocked(tributeMembers).mockResolvedValue(["TR"]);
      vi.mocked(loadGdpUsdMillionsByEntity).mockResolvedValue(
        new Map([["TR", ONE_TRILLION_IN_USD_MILLIONS]])
      );
      solventTreasury();
    };

    it("charges the Warsaw Pact at its own, higher rate", async () => {
      // The Pact's clients are worth about 2.5x less than NATO's in the 1953
      // seed, so a flat rate would hand the West a structurally deeper pool from
      // the same number of clients. Half again as much is the correction.
      chargeablePayer();
      const { chargeOrganizationTribute } = await import("./tribute");
      const pact = await chargeOrganizationTribute(db as unknown as Db, "WARSAW_PACT");

      expect(pact.payers).toBe(1);
      expect(pact.collectedLocal).toBe(
        Math.round(perTurnUsd(ONE_TRILLION_IN_USD_MILLIONS, 0.0075) / rateOf("US"))
      );

      vi.clearAllMocks();
      worldPreset(db, "1953-default");
      vi.mocked(getOrganizationFund).mockResolvedValue({
        balanceLocal: 0,
        duesRateAnnual: 0.00006,
        currencyCountryId: "US",
      } as never);
      chargeablePayer();
      const nato = await chargeOrganizationTribute(db as unknown as Db, "NATO");

      // Identical roll and identical economies — the only difference is the
      // bloc. Compared as a ratio because each side rounds to a whole unit of
      // currency independently, so they can sit half a unit apart.
      expect(pact.collectedLocal / nato.collectedLocal).toBeCloseTo(1.5, 6);
    });

    it.each(["UN", "EU", "COMMONWEALTH", "NON_ALIGNED", "COMECON", "custom-org"])(
      "charges nothing for %s",
      async (orgId) => {
        // Tribute is the two armed blocs' bargain with their clients. Charged
        // per organisation it would compound — a client of four would owe four
        // times the rate — and the UN would collect as much from the world as
        // NATO does from its own bloc.
        chargeablePayer();
        const { chargeOrganizationTribute } = await import("./tribute");
        const result = await chargeOrganizationTribute(db as unknown as Db, orgId);
        expect(result).toEqual({ collectedLocal: 0, payers: 0, minted: 0 });
        expect(budgetUpdateOne).not.toHaveBeenCalled();
      }
    );

    it.each(["1979-default", "1991-default", "2019-default"])(
      "charges nothing in a %s world",
      async (preset) => {
        // Scoped by the world's starting preset, not the live year: a 1953 game
        // keeps the arrangement as it runs forward, and no other start has it.
        worldPreset(db, preset);
        chargeablePayer();
        const { chargeOrganizationTribute } = await import("./tribute");
        const result = await chargeOrganizationTribute(db as unknown as Db, "NATO");
        expect(result).toEqual({ collectedLocal: 0, payers: 0, minted: 0 });
        expect(budgetUpdateOne).not.toHaveBeenCalled();
      }
    );

    it("still charges a 1953 world that has run past 1953", async () => {
      // The gate is the preset, so advancing the clock must not switch tribute
      // off — the arrangement lasts as long as the Cold War world does.
      worldPreset(db, "1953-default");
      db.collection("gameState").findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentYear: 1968,
      });
      chargeablePayer();
      const { chargeOrganizationTribute } = await import("./tribute");
      const result = await chargeOrganizationTribute(db as unknown as Db, "NATO");
      expect(result.payers).toBe(1);
    });
  });
});
