import { getExecutiveOfficeKey, type CountryId } from "@/lib/constants/countries";
import { officeLabel } from "@/lib/api/discordBotLabels";

/**
 * Discord role name for an office. Re-exported from the shared label module so
 * existing importers of this file keep working; see `@/lib/api/discordBotLabels`
 * for the implementation.
 */
export { officeLabel };

/**
 * getExecutiveOfficeKey throws for countries with no configured executive
 * office. None of the six supported countries are execs-less, but degrade to
 * null so a misconfiguration can never 500 the whole sync.
 */
function safeExecutiveOfficeKey(countryId: CountryId): string | null {
  try {
    return getExecutiveOfficeKey(countryId);
  } catch {
    return null;
  }
}

export interface SyncRoleTokenInput {
  countryId: CountryId;
  /** officeType keys from the character's electedOfficials rows (may be empty). */
  officeTypes: string[];
  partyName: string;
  /** Resolved by the route via getHeadOfGovernmentCharacterId (canonical). */
  isHeadOfGovernment: boolean;
  isCentralBankChair: boolean;
  isCeo: boolean;
  isInvestor: boolean;
  investorRank: number | null;
}

export interface SyncRoleTokenResult {
  roles: string[];
  officeName: string | null;
  isHeadOfGovernment: boolean;
}

/**
 * Build the role-token array the Discord bot consumes.
 *
 * - Each `officeType` becomes `office:<configLabel>`, EXCEPT the country's
 *   executive office key when the character is the head of government — that
 *   title is replaced by the single `headOfGov` token. Non-executive seats a
 *   head of gov also holds (e.g. a PM who is also an MP) still stack.
 * - Parliamentary PMs have no `electedOfficials` row at all; `headOfGov` is
 *   emitted purely from `isHeadOfGovernment`.
 * - Central bank chairs get `centralBankChair`, stacked on top of any office.
 */
export function buildSyncRoleTokens(input: SyncRoleTokenInput): SyncRoleTokenResult {
  const {
    countryId,
    officeTypes,
    partyName,
    isHeadOfGovernment,
    isCentralBankChair,
    isCeo,
    isInvestor,
    investorRank,
  } = input;

  const execKey = safeExecutiveOfficeKey(countryId);
  const roles: string[] = [`party:${partyName}`, `country:${countryId}`];

  const officeNames: string[] = [];
  for (const officeType of officeTypes) {
    // The executive title is replaced by headOfGov; other seats still stack.
    if (isHeadOfGovernment && execKey != null && officeType === execKey) continue;
    const label = officeLabel(countryId, officeType);
    officeNames.push(label);
    roles.push(`office:${label}`);
  }

  if (isHeadOfGovernment) roles.push("headOfGov");
  if (isCentralBankChair) roles.push("centralBankChair");
  if (isCeo) roles.push("ceo");
  if (isInvestor) roles.push("investor");
  if (investorRank) roles.push(`investor:${investorRank}`);

  const officeName = isHeadOfGovernment ? "Head of Government" : (officeNames[0] ?? null);

  return { roles, officeName, isHeadOfGovernment };
}
