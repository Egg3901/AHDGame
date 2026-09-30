import { emptyConflictState, normalizeConflictState } from "./engine";
import {
  ARAB_ORIGINS,
  initialArabOrigin,
  type ArabOriginId,
  type ArabOriginState,
} from "./rules/arabOrigins";
import { allocateArabRefugees, ARAB_HOSTS } from "./rules/arabRegional";
import { projectArabRegion } from "./rules/arabProjection";
import type { LivingConflictDef, LivingConflictState } from "./types";

/**
 * January 2027 is a scenario continuation of evidence available on 30 September
 * 2026, not a historical forecast. All 0-100 scores below are game calibration.
 * Earlier eras and already-seeded documents never pass through this builder.
 */
const AS_OF = "2026-09-30";
const sources: Record<string, string[]> = {
  northern_ireland: [
    "https://www.gov.uk/government/publications/the-belfast-agreement",
    "https://www.attorneygeneralni.gov.uk/news/attorney-general-welcomes-restoration-ni-executive",
  ],
  yugoslav_dissolution: ["https://www.un.org/sites/un2.un.org/files/member_states.pdf"],
  transnational_terrorism: [
    "https://www.un.org/securitycouncil/ctc/content/secretary-general%E2%80%99s-isil-reports",
  ],
  global_financial_crisis: ["https://www.imf.org/en/publications/fandd/issues/2018/03/debroeck"],
  pandemic: [
    "https://www.who.int/europe/emergencies/situations/covid-19",
    "https://www.who.int/publications/m/item/strategic-plan-for-coronavirus-disease-threat-management-at-a-glance",
  ],
  arab_uprisings: [
    "https://unsmil.unmissions.org/en/news/unsmil-welcomes-agreement-on-next-steps-towards-national-elections",
    "https://dppa.un.org/en/node/136734",
    "https://dppa.un.org/en/speeches-and-statements/asg-khiaris-remarks-to-the-security-council-on-developments-in-yemen",
    "https://transcripts.un.org/en/ecosoc/2026/33?t=41%3A38",
    "https://egypt.un.org/en/317774-government-egypt-united-nations-partners-reaffirm-shared-commitment-under-joint-platform",
    "https://spcommreports.ohchr.org/TmSearch/RelCom?code=TUN+4%2F2026",
    "https://spcommreports.ohchr.org/TmSearch/RelCom?code=TUN+1%2F2026",
    "https://spcommreports.ohchr.org/TmSearch/RelCom?code=EGY+7%2F2025",
  ],
  russia_ukraine_security: [
    "https://ukraine.un.org/en/323454-protection-civilians-armed-conflict-%E2%80%94-august-2026",
  ],
};

export interface Opening2027Context {
  countries: ReadonlySet<string>;
  populations: Readonly<Record<string, number>>;
}

/** Trajectories are dated continuity assumptions; values are bounded game scales. */
const ARAB_OPENING: Record<ArabOriginId, Partial<ArabOriginState>> = {
  TN: {
    openingSourceUrl: "https://spcommreports.ohchr.org/TmSearch/RelCom?code=TUN+4%2F2026",
    openingEvidenceAsOf: AS_OF,
    policy: "unchanged",
    trajectory: "authoritarian",
    legitimacy: 45,
    mobilization: 25,
    repression: 62,
    cohesion: 65,
    opposition: 15,
    settlement: 25,
    reconstruction: 25,
  },
  EG: {
    openingSourceUrl: "https://spcommreports.ohchr.org/TmSearch/RelCom?code=EGY+7%2F2025",
    openingEvidenceAsOf: AS_OF,
    policy: "unchanged",
    trajectory: "authoritarian",
    legitimacy: 45,
    mobilization: 28,
    repression: 65,
    cohesion: 65,
    opposition: 20,
    settlement: 30,
    reconstruction: 35,
  },
  LY: {
    openingSourceUrl: "https://unsmil.unmissions.org/en/news/unsmil-welcomes-agreement-on-next-steps-towards-national-elections",
    openingEvidenceAsOf: AS_OF,
    policy: "transition",
    trajectory: "frozen",
    legitimacy: 42,
    mobilization: 30,
    repression: 45,
    cohesion: 40,
    opposition: 45,
    outsideSupport: 18,
    civilianStrain: 42,
    displacement: 35,
    infrastructureDamage: 35,
    settlement: 68,
    reconstruction: 30,
  },
  SY: {
    openingSourceUrl: "https://dppa.un.org/en/node/136734",
    openingEvidenceAsOf: AS_OF,
    policy: "transition",
    trajectory: "transition",
    legitimacy: 50,
    mobilization: 30,
    repression: 38,
    cohesion: 48,
    opposition: 30,
    civilianStrain: 55,
    displacement: 60,
    infrastructureDamage: 65,
    settlement: 58,
    reconstruction: 32,
  },
  YE: {
    openingSourceUrl: "https://dppa.un.org/en/speeches-and-statements/asg-khiaris-remarks-to-the-security-council-on-developments-in-yemen",
    openingEvidenceAsOf: AS_OF,
    policy: "unchanged",
    trajectory: "civil_war",
    legitimacy: 30,
    mobilization: 58,
    repression: 62,
    cohesion: 35,
    opposition: 60,
    outsideSupport: 35,
    civilianStrain: 75,
    displacement: 68,
    infrastructureDamage: 62,
    settlement: 20,
    reconstruction: 10,
  },
};

function inherited(
  def: LivingConflictDef,
  phaseLevel: number,
  status: LivingConflictState["status"],
  openedYear: number,
  tracks: Record<string, number>,
  disposition: LivingConflictState["openingDisposition"] = "inherited"
): LivingConflictState {
  return normalizeConflictState(def, {
    ...emptyConflictState(def.key),
    hasOpened: true,
    status,
    phaseLevel,
    openedYear,
    intensity: status === "active" ? 45 : 15,
    tracks,
    // Operational sentinels, not invented counts of historical hourly turns.
    phaseTurns: 1,
    totalTurns: 1,
    emitPhaseEntryNextTurn: false,
    openingDisposition: disposition,
    openingProvenance: {
      preset: "2027-default",
      evidenceAsOf: AS_OF,
      sourceUrls: sources[def.key],
      scale: "modeled_continuity",
    },
  });
}

/** Exactly seven inherited families; unlisted definitions keep their normal opening path. */
export function build2027ConflictOpening(
  def: LivingConflictDef,
  context: Opening2027Context
): LivingConflictState {
  const provenance = {
    preset: "2027-default" as const,
    evidenceAsOf: AS_OF,
    sourceUrls: sources[def.key],
    scale: "modeled_continuity" as const,
  };
  switch (def.key) {
    case "northern_ireland":
      return inherited(def, 6, "settled", 1991, {
        violence: 20,
        settlementMomentum: 80,
        legitimacy: 60,
        unionistConsent: 65,
        nationalistConsent: 65,
        decommissioning: 65,
        institutionalStability: 60,
        domesticConsent: 65,
        referendumRatification: 1,
        ratificationAuthorization: 2,
        ratificationFailureCount: 0,
      });
    case "yugoslav_dissolution":
      return context.countries.has("YU")
        ? {
            ...emptyConflictState(def.key),
            openingDisposition: "counterfactual",
            openingProvenance: provenance,
          }
        : {
            ...emptyConflictState(def.key),
            status: "closed",
            openingDisposition: "not_applicable",
            openingProvenance: provenance,
          };
    case "transnational_terrorism":
      return inherited(def, 6, "active", 1998, {
        threatCapability: 30,
        intelligenceCoverage: 65,
        plotReadiness: 25,
        attributionConfidence: 55,
        publicFear: 25,
        civilLiberties: 62,
        allianceCohesion: 60,
        interventionCommitment: 20,
        insurgency: 30,
        warWeariness: 45,
      });
    case "global_financial_crisis":
      return inherited(
        def,
        7,
        "closed",
        2007,
        {
          financialFragility: 18,
          liquidityStress: 12,
          bankSolvency: 75,
          contagion: 5,
          householdDistress: 15,
          unemployment: 12,
          marketConfidence: 68,
          sovereignSpreads: 15,
          euroSovereignExposure: 15,
          creditorConsent: 65,
          recovery: 75,
        },
        "settled"
      );
    case "pandemic":
      return {
        ...inherited(
          def,
          5,
          "settled",
          2019,
          {
            transmission: 12,
            surveillance: 65,
            healthCapacity: 75,
            publicTrust: 55,
            restrictionFatigue: 25,
            vaccineResearch: 85,
            manufacturing: 65,
            distributionEquity: 50,
            supplyChainStrain: 8,
            immunity: 72,
            containmentPolicy: 5,
            travelControls: 0,
            researchInvestment: 15,
            manufacturingInvestment: 10,
            capacityInvestment: 10,
            cooperation: 35,
            economicSupport: 5,
            variantWaves: 20,
            distributionInvestment: 15,
          },
          "settled"
        ),
        pandemicOriginCountryId: "CN",
      };
    case "arab_uprisings": {
      const origins = Object.fromEntries(
        ARAB_ORIGINS.map((id) => [
          id,
          {
            ...initialArabOrigin({
              countryId: id,
              population: context.populations[id] ?? 0,
              legitimacy: ARAB_OPENING[id].legitimacy ?? 50,
              foodStress: 1,
              basis: "background",
            }),
            ...ARAB_OPENING[id],
          },
        ])
      ) as Record<ArabOriginId, ArabOriginState>;
      const hosts = Object.fromEntries(
        ARAB_HOSTS.filter((id) => (context.populations[id] ?? 0) > 0).map((id) => [
          id,
          { population: context.populations[id], protection: 0, refugeePeople: 0 },
        ])
      );
      const state = inherited(def, 6, "active", 2010, {});
      const projected = projectArabRegion({
        ...state,
        arabRegional: allocateArabRefugees({ origins, hosts, resolutionIds: [] }),
      });
      return { ...projected, phaseTurns: 1, totalTurns: 1 };
    }
    case "russia_ukraine_security":
      return inherited(def, 5, "active", 2013, {
        ukrainianLegitimacy: 55,
        territorialControl: 50,
        coercivePressure: 68,
        directIntervention: 70,
        separatistCapacity: 45,
        deterrence: 55,
        allianceCohesion: 65,
        sanctionsPressure: 55,
        westernAid: 55,
        displacement: 60,
        infrastructureDamage: 60,
        escalationRisk: 60,
        warWeariness: 65,
        settlementMomentum: 20,
        reconstruction: 10,
      });
    default:
      return emptyConflictState(def.key);
  }
}

export const AUTHORED_2027_FAMILIES = Object.keys(sources);
