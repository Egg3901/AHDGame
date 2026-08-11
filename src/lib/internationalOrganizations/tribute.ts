/**
 * Tribute — what a member pays when it has no vote.
 *
 * Dues are a levy the voting members set on themselves. Tribute is the other
 * half of the same bargain: a client state or a macro-tier entity contributes to
 * the bloc's pool at a fixed rate it does not get to argue with, and in exchange
 * it is not billed the voted dues on top. `votingMembers` and `tributeMembers`
 * partition the roll, so nobody is ever billed BOTH.
 *
 * They do not partition it into two paying halves, though, and deliberately so:
 * outside the scope below a non-voting member pays nothing at all — not dues,
 * which are voters-only, and not tribute. Belonging to the UN costs a client
 * state nothing, which is the intended reading of the scope.
 *
 * SCOPE AND PRICE. Only NATO and the Warsaw Pact levy it, at rates of their own,
 * and only in a world that began at the 1953 preset — `ORG_TRIBUTE_RATES_ANNUAL`
 * holds both facts and `orgTributeRateAnnual` is the one place the rule is
 * applied. This is a Cold War bargain between the two armed blocs and their
 * clients, not a general property of belonging to an organisation.
 *
 * Two asymmetries are deliberate:
 *
 * - **The rate is fixed, not voted.** Letting the members who vote set what the
 *   members who cannot vote owe would be taxation without representation.
 * - **Debit where a treasury exists, mint where it does not.** A non-enabled
 *   full country has a `federalBudget` and pays real money out of it, into debt
 *   if that is where its books already sit — a state meets its obligations by
 *   borrowing. A macro entity has no treasury modelled at all, so its tribute is
 *   created — and reported as `minted`, so the fiction is visible rather than
 *   silent.
 */
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getGdpAnchorRate, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import {
  DEFAULT_ORG_DUES_RATE_ANNUAL,
  GDP_MILLIONS_TO_USD,
  ORG_DUES_TURNS_PER_YEAR,
  ORG_TRIBUTE_RATES_ANNUAL,
  orgTributeRateAnnual,
  type InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";
import { getOrganizationFundsCollection } from "@/lib/db/collections/organizationFunds";
import type { FederalBudget } from "@/lib/db/types";
import { loadGdpUsdMillionsByEntity } from "./entityGdp";
import { getOrganizationFund } from "./organizationFund";
import { tributeMembers, type AccessTable } from "./orgMembership";

export interface TributeResult {
  /** Total credited to the fund, in the fund's own currency. */
  collectedLocal: number;
  /** How many members actually paid. */
  payers: number;
  /** Share of `collectedLocal` that had no treasury behind it. */
  minted: number;
}

const EMPTY: TributeResult = { collectedLocal: 0, payers: 0, minted: 0 };

export async function chargeOrganizationTribute(
  db: Db,
  organizationId: string,
  access?: AccessTable
): Promise<TributeResult> {
  // Cheapest gate first: only the two armed blocs levy tribute at all, so every
  // other organisation costs one lookup rather than a database read.
  if (!(organizationId in ORG_TRIBUTE_RATES_ANNUAL)) return { ...EMPTY };

  // Era-aware, and doing double duty. It scopes tribute to the 1953 start, and
  // it is the same resolver `chargeOrganizationDues` uses to normalise currency
  // — reading the BASE config would price a 1953 world at 2019 rates and leave
  // dues and tribute disagreeing about what a currency is worth (refs #3778).
  const preset = await loadWorldPreset(db);
  const rateAnnual = orgTributeRateAnnual(organizationId, preset);
  if (rateAnnual <= 0) return { ...EMPTY };

  const payers = await tributeMembers(db, organizationId, access);
  if (payers.length === 0) return { ...EMPTY };

  const gdpByEntity = await loadGdpUsdMillionsByEntity(db, payers);
  if (gdpByEntity.size === 0) return { ...EMPTY };

  const { currencyCountryId } = await getOrganizationFund(
    db,
    organizationId as InternationalOrganizationId
  );
  const fundRate = getGdpAnchorRate(currencyCountryId, preset);
  const budget = db.collection<FederalBudget>("federalBudget");
  const now = new Date();

  // One read for the whole roll rather than one per payer: this runs inside a
  // per-organisation sweep every turn, so a findOne here would fan out to a
  // round-trip per membership across the whole world.
  const treasuries = new Map(
    (await budget.find({ countryId: { $in: payers as CountryId[] } }).toArray()).map((row) => [
      row.countryId as string,
      row,
    ])
  );

  let collectedLocal = 0;
  let minted = 0;
  let paid = 0;

  for (const payer of payers) {
    // Absent from the map means "no economic data", which is not the same as a
    // GDP of zero — an entity we cannot price is skipped, not charged nothing.
    const gdpUsdMillions = gdpByEntity.get(payer);
    if (gdpUsdMillions === undefined || !(gdpUsdMillions > 0)) continue;

    const owedUsd = (gdpUsdMillions * GDP_MILLIONS_TO_USD * rateAnnual) / ORG_DUES_TURNS_PER_YEAR;
    if (!(owedUsd > 0)) continue;

    const fundCredit = Math.round(owedUsd / fundRate);
    if (fundCredit <= 0) continue;

    // A row at all, not a solvent one: its absence is what marks an entity the
    // game does not model a treasury for, whose tribute has to be minted.
    const treasury = treasuries.get(payer);
    if (treasury) {
      const payerRate = getGdpAnchorRate(payer as CountryId, preset);
      const owedLocal = Math.round(owedUsd / payerRate);
      // Charged whatever the treasury's sign, exactly as dues are.
      //
      // This used to be floored at solvency — "never push a treasury negative"
      // — which sounded prudent and made the whole system inert. A treasury
      // balance is a SIGNED cash position where negative simply means national
      // debt, and in 1953 every priced NATO member is in debt (France at
      // -$4.2tn). Under the floor not one member ever paid, so tribute
      // collected nothing at all. A state meets its obligations by borrowing;
      // the consequences of that debt are modelled by debt-to-GDP, the credit
      // rating and sovereign default, not by an alliance declining to invoice.
      await budget.updateOne(
        { countryId: payer as CountryId },
        { $inc: { treasuryBalance: -owedLocal }, $set: { updatedAt: now } }
      );
    } else {
      minted += fundCredit;
    }

    collectedLocal += fundCredit;
    paid++;
  }

  if (collectedLocal > 0) {
    const col = await getOrganizationFundsCollection(db);
    await col.updateOne(
      { organizationId: organizationId as InternationalOrganizationId },
      {
        $inc: { balanceLocal: collectedLocal },
        $set: { updatedAt: now },
        $setOnInsert: {
          _id: new ObjectId(),
          organizationId: organizationId as InternationalOrganizationId,
          currencyCountryId,
          // If tribute is what first creates the fund row, it still has to carry
          // a dues rate — the voting members' levy is a separate lever and must
          // not be left undefined by the order the two happen to run in.
          duesRateAnnual: DEFAULT_ORG_DUES_RATE_ANNUAL,
        },
      },
      { upsert: true }
    );
  }

  return { collectedLocal, payers: paid, minted };
}
