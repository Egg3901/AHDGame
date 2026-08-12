/**
 * DD Land (Bezirk) day-one regional policy sidecar.
 *
 * Kept OUT of the locked 109-law DD↔RU core catalog so topology/cost parity
 * tests stay intact. These are `allowedScope: "regional"` secondaries — they
 * never write national statePolicies / national enactedLaws, and they feed
 * political-metrics only as regional supplements (×0.5).
 *
 * Domains mirror DE Land / CN provincial service delivery (education, health,
 * housing/utilities, transit, culture, environment) with GDR territorial
 * framing. Coercive security stays national (Volkspolizei / MfS).
 */

import type { PoliticalLaw } from "../types";

/** 1953 Länder / Bezirke ids used by the live 1953-default world. */
export const DD_LAND_STATE_IDS = ["BEO", "MV", "BB", "ST", "SN", "TH"] as const;
export type DdLandStateId = (typeof DD_LAND_STATE_IDS)[number];

export const DD_LAND_LAWS: PoliticalLaw[] = [
  {
    id: "dd.sec.landPolytechnicEducation",
    countryId: "DD",
    kind: "secondary",
    targets: [
      { metricId: "education.universalSchooling", weight: 0.5 },
      { metricId: "education.teacherCorps", weight: 0.4 },
      { metricId: "education.attainment", weight: 0.3 },
    ],
    title: "Bezirk Polytechnic Schools Act",
    description:
      "The Land's school and polytechnic envelope — teachers, workshops, and the ten-year curriculum on territorial account.",
    category: "education",
    allowedScope: "regional",
    baselineLevel: 3,
    levels: [
      {
        name: "No Territorial Schools Budget",
        description: "No Land school budget; classrooms wait on the centre's next allocation.",
      },
      {
        name: "Emergency Classrooms",
        description: "Emergency classrooms and temporary teachers patch the worst gaps.",
        gdpCostFraction: 0.0008,
      },
      {
        name: "District School Network",
        description: "A district school network keeps polytechnics staffed and heated.",
        gdpCostFraction: 0.0016,
      },
      {
        name: "Bezirk Education Plan",
        description:
          "The Bezirk education plan: ten-year schooling, workshop places, and teacher housing on schedule.",
        gdpCostFraction: 0.0028,
      },
      {
        name: "Full Polytechnic Standard",
        description:
          "A full polytechnic standard — every child a place, every workshop tooled, class sizes capped.",
        gdpCostFraction: 0.0042,
      },
    ],
  },
  {
    id: "dd.sec.landPolyclinicNetwork",
    countryId: "DD",
    kind: "secondary",
    targets: [
      { metricId: "health.universalCare", weight: 0.5 },
      { metricId: "health.outcomes", weight: 0.4 },
      { metricId: "health.prevention", weight: 0.3 },
    ],
    title: "Bezirk Polyclinic Network Act",
    description:
      "Polyclinics, district hospitals, and the ambulatory network the Land is meant to keep standing.",
    category: "health",
    allowedScope: "regional",
    baselineLevel: 3,
    levels: [
      {
        name: "No Territorial Health Budget",
        description: "No Land health budget; wards close when the centre's remittance slips.",
      },
      {
        name: "Emergency Wards",
        description: "Emergency wards and borrowed staff keep the doors open.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "District Clinic Network",
        description: "A district clinic network covers ambulatory care and maternity.",
        gdpCostFraction: 0.0018,
      },
      {
        name: "Bezirk Health Plan",
        description:
          "The Bezirk health plan: polyclinics, beds, and prevention teams on a published roster.",
        gdpCostFraction: 0.0031,
      },
      {
        name: "Universal Care Standard",
        description:
          "A universal territorial care standard — beds and clinics guaranteed in every Kreisstädte.",
        gdpCostFraction: 0.0046,
      },
    ],
  },
  {
    id: "dd.sec.landCommunalHousing",
    countryId: "DD",
    kind: "secondary",
    targets: [
      { metricId: "infrastructure.publicHousing", weight: 0.5 },
      { metricId: "infrastructure.utilities", weight: 0.4 },
      { metricId: "infrastructure.condition", weight: 0.3 },
    ],
    title: "Communal Housing and District Heating Act",
    description:
      "Wohnungsbau, Fernwärme, and the communal services that make a Plattenbau block liveable.",
    category: "infrastructure",
    allowedScope: "regional",
    baselineLevel: 2,
    levels: [
      {
        name: "No Communal Programme",
        description: "No communal programme; heating and flats wait on national prioritisation.",
      },
      {
        name: "Emergency Repairs",
        description: "Emergency repairs keep boilers and roofs from failing through winter.",
        gdpCostFraction: 0.001,
      },
      {
        name: "District Housing Roster",
        description: "A district housing roster assigns flats and keeps the district heat on.",
        gdpCostFraction: 0.002,
      },
      {
        name: "Bezirk Communal Plan",
        description:
          "The Bezirk communal plan: new blocks, district heating laterals, and utility crews.",
        gdpCostFraction: 0.0034,
      },
      {
        name: "Full Housing Standard",
        description:
          "A full housing standard — every household heated, piped, and queued for a modern flat.",
        gdpCostFraction: 0.005,
      },
    ],
  },
  {
    id: "dd.sec.landTransitRoads",
    countryId: "DD",
    kind: "secondary",
    targets: [
      { metricId: "infrastructure.transit", weight: 0.5 },
      { metricId: "infrastructure.highways", weight: 0.4 },
      { metricId: "infrastructure.development", weight: 0.3 },
    ],
    title: "Local Transit and Roads Act",
    description:
      "Straßenbahn, bus, and the secondary roads that move workers to the combine each morning.",
    category: "infrastructure",
    allowedScope: "regional",
    baselineLevel: 2,
    levels: [
      {
        name: "No Local Transit Budget",
        description: "No local transit budget; routes shrink when fuel and parts run short.",
      },
      {
        name: "Skeleton Services",
        description: "Skeleton services keep the peak-hour routes alive.",
        gdpCostFraction: 0.0007,
      },
      {
        name: "District Transit Network",
        description: "A district transit network covers the Kreisstädte and factory gates.",
        gdpCostFraction: 0.0015,
      },
      {
        name: "Bezirk Transport Plan",
        description:
          "The Bezirk transport plan: rolling stock, road crews, and freight access on schedule.",
        gdpCostFraction: 0.0026,
      },
      {
        name: "Integrated Territorial Transit",
        description:
          "Integrated territorial transit — frequent service, repaired roads, and timed factory connections.",
        gdpCostFraction: 0.0039,
      },
    ],
  },
  {
    id: "dd.sec.landCultureYouth",
    countryId: "DD",
    kind: "secondary",
    targets: [
      { metricId: "society.civicLife", weight: 0.5 },
      { metricId: "society.integration", weight: 0.35 },
      { metricId: "education.adultSkills", weight: 0.3 },
    ],
    title: "Houses of Culture and Youth Act",
    description:
      "Kulturhäuser, libraries, FDJ clubs, and the quiet territorial work of socialist leisure.",
    category: "society",
    allowedScope: "regional",
    baselineLevel: 2,
    levels: [
      {
        name: "No Cultural Programme",
        description: "No cultural programme; halls go dark when the coal allocation slips.",
      },
      {
        name: "Volunteer Circles",
        description: "Volunteer circles keep a few houses of culture and libraries open.",
        gdpCostFraction: 0.0004,
      },
      {
        name: "District Cultural Roster",
        description: "A district cultural roster funds houses of culture, youth clubs, and libraries.",
        gdpCostFraction: 0.0009,
      },
      {
        name: "Bezirk Culture Plan",
        description:
          "The Bezirk culture plan: programmed seasons, touring ensembles, and youth facilities.",
        gdpCostFraction: 0.0016,
      },
      {
        name: "Full Cultural Provision",
        description:
          "Full cultural provision — a house of culture in every town and a packed youth calendar.",
        gdpCostFraction: 0.0024,
      },
    ],
  },
  {
    id: "dd.sec.landSanitationReclamation",
    countryId: "DD",
    kind: "secondary",
    targets: [
      { metricId: "environment.urbanAir", weight: 0.5 },
      { metricId: "environment.stewardship", weight: 0.4 },
      { metricId: "environment.conservation", weight: 0.3 },
    ],
    title: "Industrial Sanitation and Land Reclamation Act",
    description:
      "Smoke, slag, and the slow reclaiming of spoil tips the combine leaves behind.",
    category: "environment",
    allowedScope: "regional",
    baselineLevel: 2,
    levels: [
      {
        name: "No Sanitation Programme",
        description: "No sanitation programme; stacks smoke and spoil tips grow unchecked.",
      },
      {
        name: "Complaint-Driven Cleanup",
        description: "Complaint-driven cleanup answers only the worst district grievances.",
        gdpCostFraction: 0.0005,
      },
      {
        name: "District Sanitation Crews",
        description: "District sanitation crews abate dust, slag, and the worst water foulings.",
        gdpCostFraction: 0.0011,
      },
      {
        name: "Bezirk Reclamation Plan",
        description:
          "The Bezirk reclamation plan: scheduled tips, filters, and shelterbelts around the works.",
        gdpCostFraction: 0.0019,
      },
      {
        name: "Full Territorial Remediation",
        description:
          "Full territorial remediation — air, water, and spoil brought under a published standard.",
        gdpCostFraction: 0.0029,
      },
    ],
  },
];
