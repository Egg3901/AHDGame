/**
 * East Germany corporation seed constants.
 *
 * DD is a command economy and deliberately has **no PRIVATE corporations** —
 * its producing base is state-owned. What this OID trio identifies is the
 * bare sovereign issuer, because `seedSovereignBondInstruments` resolves the
 * country-owned corporation to hang bond tranches off. Without one it falls
 * back to `new ObjectId()`, and DD's seeded DDM 3B of debt ends up pointing at
 * a corporation that does not exist.
 *
 * So this is the bare issuer only: `generateCountryOwnedSeedData` emits it with
 * `sectors: []`, exactly like the other sovereign-issuer-only countries.
 *
 * As of ticket #1014, DD's PRODUCING base is a SEPARATE stack of one SOE
 * corporation per CorporationType (full sector board, with plants capacity) —
 * see `WARSAW_PACT_SOE_SPEC` in `seeds/reference/budgets.ts` and
 * `COMMAND_ECONOMY_SOE_SECTORS.DD` in `constants/commandEconomy.ts`. Those
 * SOEs carry their own disjoint ids (the `0x1500` band via
 * `SOE_ID_BASE_BY_COUNTRY.DD`) and are never the primary/issuer corporation —
 * this bare shell stays the single `isPrimaryNationalCorporation` entity.
 */

/** Placeholder ObjectId string for the DD sovereign corporation. */
export const DD_PUBLIC_CORPORATION_OID = "700000000000000000000091";
/** Placeholder ObjectId string for the DD sovereign CEO. */
export const DD_PUBLIC_CEO_OID = "700000000000000000000092";
/** Placeholder ObjectId string for the DD sovereign user. */
export const DD_PUBLIC_USER_OID = "700000000000000000000093";
/** Reserved sequential ID for the DD sovereign corporation. */
export const DD_PUBLIC_SEQUENTIAL_ID = 900_010;
