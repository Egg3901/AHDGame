import type { PledgeCatalogEntry } from "@/lib/db/types/manifesto";

/**
 * Curated UK manifesto pledge catalog (epic #856, ticket #857).
 *
 * Each entry maps to REAL UK legislation ids from
 * `src/lib/politicalLegislation/laws/ukLaws.ts`. UK "primary" laws use a
 * `levels[]` ladder (0 = least provision → 4 = most), recorded in `enactedLaws`
 * as `policyOptionIndex`; targets therefore use `policyOptionLevel`.
 *
 * `position` is the pledge's stance on the shared -5..+5 axes (economic, social)
 * for popularity scoring. `salienceByGroup` keys are Layer-1 demographic bucket
 * ids; absent keys fall back to `baseSalience`. Salience values here are a
 * first pass and are the primary thing to tune in worldsim.
 *
 * NOTE: demographic bucket ids used in salienceByGroup should be reconciled
 * against the live UK demographic categories before enabling scoring; unknown
 * keys degrade gracefully to baseSalience, so a wrong key under-weights rather
 * than crashes.
 */
export const UK_PLEDGE_CATALOG: PledgeCatalogEntry[] = [
  {
    id: "uk.nhs.universal",
    label: "A universal, comprehensive NHS",
    blurb: "Full care free at the point of use, from spectacles to surgery.",
    policyDomain: "health",
    targets: [{ legislationTypeId: "uk.health.universalCare.primary", policyOptionLevel: 4 }],
    position: { economic: -3.5, social: -0.5 },
    targetSemantics: "enact",
    baseSalience: 0.85,
    salienceByGroup: { "wealth:low": 1, "age:senior": 1, "wealth:high": 0.4 },
    countryId: "UK",
  },
  {
    id: "uk.nhs.protect",
    label: "Protect the NHS",
    blurb: "No cuts to the health service on our watch.",
    policyDomain: "health",
    targets: [{ legislationTypeId: "uk.health.universalCare.primary", policyOptionLevel: 3 }],
    position: { economic: -2, social: 0 },
    targetSemantics: "maintain",
    baseSalience: 0.8,
    salienceByGroup: { "age:senior": 1, "wealth:low": 0.9 },
    countryId: "UK",
  },
  {
    id: "uk.tax.cutIncome",
    label: "Cut income tax",
    blurb: "Let working people keep more of what they earn.",
    policyDomain: "economy",
    // Tax laws are slider/option-based (rate:*), not level ladders; the exact
    // option id is resolved at wiring time. Left without a concrete option id
    // until the tax-slider target contract is confirmed (see #857).
    targets: [{ legislationTypeId: "uk.tax.incomeTax" }],
    position: { economic: 3.5, social: 0 },
    targetSemantics: "enact",
    baseSalience: 0.6,
    salienceByGroup: { "wealth:high": 1, "wealth:mid": 0.7, "wealth:low": 0.3 },
    countryId: "UK",
  },
  {
    id: "uk.economy.workerProtections",
    label: "Strengthen workers' rights",
    blurb: "Real employment protections, not the bare statutory minimum.",
    policyDomain: "economy",
    targets: [{ legislationTypeId: "uk.economy.workerSecurity.primary", policyOptionLevel: 3 }],
    position: { economic: -3.5, social: -1 },
    targetSemantics: "enact",
    baseSalience: 0.6,
    salienceByGroup: { "wealth:low": 0.9, "education:no_college": 0.8, "wealth:high": 0.3 },
    countryId: "UK",
  },
  {
    id: "uk.education.secondaryForAll",
    label: "Secondary education for all",
    blurb: "A national settlement guaranteeing schooling for every child.",
    policyDomain: "education",
    targets: [
      { legislationTypeId: "uk.education.universalSchooling.primary", policyOptionLevel: 3 },
    ],
    position: { economic: -2.5, social: -1.5 },
    targetSemantics: "enact",
    baseSalience: 0.5,
    salienceByGroup: { "age:young": 0.8, "education:college": 0.7 },
    countryId: "UK",
  },
  {
    id: "uk.economy.industrialModernization",
    label: "Modernise British industry",
    blurb: "Investment incentives and an industrial modernization drive.",
    policyDomain: "economy",
    targets: [{ legislationTypeId: "uk.economy.productivity.primary", policyOptionLevel: 3 }],
    position: { economic: -1, social: -0.5 },
    targetSemantics: "enact",
    baseSalience: 0.45,
    salienceByGroup: { "education:no_college": 0.6, "wealth:mid": 0.6 },
    countryId: "UK",
  },
  {
    id: "uk.economy.soundMoney",
    label: "Sound money and fiscal discipline",
    blurb: "Exchequer rules and a firm hand on the public finances.",
    policyDomain: "economy",
    targets: [{ legislationTypeId: "uk.economy.fiscal.primary", policyOptionLevel: 3 }],
    position: { economic: 3, social: 1 },
    targetSemantics: "enact",
    baseSalience: 0.5,
    salienceByGroup: { "wealth:high": 0.9, "wealth:mid": 0.6, "wealth:low": 0.3 },
    countryId: "UK",
  },
];

/** Lookup a catalog entry by id. */
export function getPledgeCatalogEntry(id: string): PledgeCatalogEntry | undefined {
  return UK_PLEDGE_CATALOG.find((e) => e.id === id);
}

/** Catalog entries available for a country (+ optional era). */
export function pledgeCatalogFor(countryId: string, era?: string): PledgeCatalogEntry[] {
  return UK_PLEDGE_CATALOG.filter(
    (e) => e.countryId === countryId && (!e.eras || !era || e.eras.includes(era))
  );
}
