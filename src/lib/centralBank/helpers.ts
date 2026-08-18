import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";

export function getBankId(countryId: CountryId): string {
  return COUNTRY_CONFIGS[countryId]?.centralBank.sharedBankId ?? countryId;
}

/**
 * Empty the committee's chair seat when the single-chair mirror is vacated
 * (resignation, dismissal, executive-independence removal).
 *
 * Clearing only `chairCharacterId` left the departed chair sitting in
 * `fomcBoard`'s seat 0, where their alignment kept tabling motions and the page
 * kept naming them. Backdating `termExpiresAtTurn` lets the next
 * `refreshExpiredSeats` pass drop a caretaker technocrat in, which in turn
 * routes the vacancy to the player selection phase.
 *
 * No-op for banks without a committee.
 */
export async function vacateFomcChairSeat(db: Db, bankId: string): Promise<void> {
  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bankId, "fomcBoard.isChair": true },
    {
      $set: {
        "fomcBoard.$[chair].occupantType": "vacant",
        "fomcBoard.$[chair].characterId": null,
        "fomcBoard.$[chair].characterName": null,
        "fomcBoard.$[chair].nppId": null,
        "fomcBoard.$[chair].appointedByPresidentId": null,
        "fomcBoard.$[chair].termExpiresAtTurn": 0,
      },
    },
    { arrayFilters: [{ "chair.isChair": true }] }
  );
}

/**
 * Build a countryId → primeRate lookup from central-bank docs, resolving every
 * configured country through its (possibly shared) bank doc. Bank docs are
 * keyed by bank `_id`, and a shared doc's `countryId` only names the anchor
 * member — e.g. the ECB doc carries `countryId: "DE"`. SCO/WAL resolve through
 * the UK bank. Keying a map by `bank.countryId` silently drops every non-anchor
 * member.
 */
export function buildPrimeRateByCountry(
  banks: Array<Pick<CentralBank, "countryId" | "primeRate"> & { _id: string }>
): Map<CountryId, number> {
  const rateByBankId = new Map(banks.map((bank) => [String(bank._id), bank.primeRate]));
  const map = new Map<CountryId, number>();
  for (const countryId of COUNTRY_ORDER) {
    const rate = rateByBankId.get(getBankId(countryId));
    if (typeof rate === "number" && Number.isFinite(rate)) map.set(countryId, rate);
  }
  // Defensive: keep any doc whose countryId is not covered by COUNTRY_ORDER
  // (e.g. era-specific entities) resolvable under its own countryId.
  for (const bank of banks) {
    if (
      bank.countryId &&
      !map.has(bank.countryId) &&
      typeof bank.primeRate === "number" &&
      Number.isFinite(bank.primeRate)
    ) {
      map.set(bank.countryId, bank.primeRate);
    }
  }
  return map;
}

export function getConfiguredSharedBankMemberCountries(
  bankId: string,
  intorgId?: string
): CountryId[] {
  return COUNTRY_ORDER.map((id) => COUNTRY_CONFIGS[id])
    .filter((config) => {
      const configBankId = config.centralBank.sharedBankId ?? config.id;
      if (configBankId !== bankId) return false;
      if (intorgId && config.centralBank.centralBankIntorgId !== intorgId) return false;
      return true;
    })
    .map((config) => config.id);
}

export function getRepresentativeCentralBankCountry(intorgId: string): CountryId | null {
  return (
    COUNTRY_ORDER.map((id) => COUNTRY_CONFIGS[id])
      .filter((config) => config.centralBank.centralBankIntorgId === intorgId)
      .map((config) => config.id)[0] ?? null
  );
}

export async function getIntorgMemberCountries(db: Db, intorgId: string): Promise<CountryId[]> {
  const builtIn = INTERNATIONAL_ORGANIZATIONS[intorgId as keyof typeof INTERNATIONAL_ORGANIZATIONS];
  const defaults = (builtIn?.foundingMembers ?? []) as CountryId[];
  const docs = await db
    .collection<OrganizationMembership>("organizationMemberships")
    .find({ organizationId: intorgId })
    .project<{ countryId: CountryId }>({ countryId: 1 })
    .toArray();
  return [...new Set([...defaults, ...docs.map((d) => d.countryId)])].filter(
    (countryId): countryId is CountryId => countryId in COUNTRY_CONFIGS
  );
}

export async function getIntorgBankForOrg(db: Db, orgId: string): Promise<CentralBank | null> {
  return db.collection<CentralBank>("centralBanks").findOne({ intorgId: orgId });
}

function getDefaultBank(countryId: CountryId, now: Date): Omit<CentralBank, "_id"> {
  const config = COUNTRY_CONFIGS[countryId];
  return {
    countryId,
    chairCharacterId: null,
    chairCharacterName: null,
    chairAppointedAt: null,
    chairAppointedBy: null,
    primeRate: config.centralBank.defaultPrimeRate,
    rateHistory: [],
    chairInfamy: 0,
    chairTermExpiresAtTurn: null,
    nominations: [],
    lobbyingPool: [],
    interestRateHistory: [],
    inflationHistory: [],
    gdpGrowthHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildCentralBankBootstrapUpdate(
  countryId: CountryId,
  bankId: string,
  intorgId?: string,
  now: Date = new Date()
) {
  return {
    $setOnInsert: { _id: bankId, ...getDefaultBank(countryId, now) },
    ...(intorgId ? { $set: { intorgId } } : {}),
  };
}

export async function getCentralBankScope(
  db: Db,
  countryId: CountryId
): Promise<{ bankId: string; memberCountries: CountryId[]; intorgId?: string }> {
  const intorgId = COUNTRY_CONFIGS[countryId]?.centralBank.centralBankIntorgId;
  const bankId = getBankId(countryId);
  if (!intorgId) return { bankId, memberCountries: [countryId] };

  const configuredMembers = getConfiguredSharedBankMemberCountries(bankId, intorgId);
  const configuredMemberSet = new Set(configuredMembers);
  const orgMembers = await getIntorgMemberCountries(db, intorgId);

  // Shared-bank scope must stay inside the countries wired to this bank, even
  // if the wider organization has non-euro members or future joiners.
  const memberCountries = orgMembers.filter((memberCountryId) =>
    configuredMemberSet.has(memberCountryId)
  );

  return {
    bankId,
    memberCountries:
      memberCountries.length > 0
        ? memberCountries
        : configuredMembers.length > 0
          ? configuredMembers
          : [countryId],
    intorgId,
  };
}
