/** Authored Cabinet action menu for the reset. Live v1 orders remain separate. */
import actions from "./actionCatalog.json";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";

export type ActionCostClass = "Ops" | "Staff" | "Surge";
export type ActionScope = "Nat" | "Vet" | "NI" | "SCT" | "WAL";

export interface ResetCabinetAction {
  id: string;
  country: ResetCountry;
  seatId: string;
  slot: number;
  title: string;
  target: string;
  targetNames: readonly string[];
  strength: number;
  costClass: ActionCostClass;
  scope: ActionScope;
  brief: string;
  description: string;
}

const authored = actions as ResetCabinetAction[];
const ukActions = authored.filter((action) => action.country === "UK");

const ieSeatSources: Readonly<Record<string, string>> = {
  taoiseach: "deputy_prime_minister",
  tanaiste: "deputy_prime_minister",
  minister_for_public_expenditure: "first_secretary_of_state",
  minister_for_finance: "chancellor",
  minister_for_foreign_affairs: "foreign_secretary",
  minister_for_enterprise: "business_secretary",
  minister_for_health: "health_secretary",
  minister_for_education: "education_secretary",
  minister_for_further_higher_education: "education_secretary",
  minister_for_housing: "levelling_secretary",
  minister_for_social_protection: "work_secretary",
  minister_for_justice: "home_secretary",
  minister_for_defence: "defence_secretary",
  minister_for_environment_climate: "environment_secretary",
  minister_for_agriculture: "agriculture_secretary",
  minister_for_transport: "transport_secretary",
  minister_for_children: "northern_ireland",
  minister_for_rural_community: "scotland",
  minister_for_tourism_culture: "wales",
};

const successorSeatSources: Readonly<Record<string, string>> = {
  deputyFirstMinister: "deputy_prime_minister",
  financeSecretary: "chancellor",
  externalAffairsSecretary: "foreign_secretary",
  justiceSecretary: "justice_secretary",
  defenceSecretary: "defence_secretary",
  healthSecretary: "health_secretary",
  educationSecretary: "education_secretary",
  economySecretary: "business_secretary",
  communitiesSecretary: "levelling_secretary",
  transportSecretary: "transport_secretary",
  netZeroSecretary: "environment_secretary",
  socialJusticeSecretary: "work_secretary",
};

function localizedActions(
  country: "IE" | "SCO" | "WAL",
  seatSources: Readonly<Record<string, string>>
): ResetCabinetAction[] {
  return Object.entries(seatSources).flatMap(([seatId, sourceSeat]) =>
    ukActions
      .filter((action) => action.seatId === sourceSeat)
      .map((action) => ({
        ...action,
        id: `${country.toLowerCase()}_${seatId}_${action.slot}`,
        country,
        seatId,
        scope: "Nat" as const,
        title: action.title
          .replace("NHS", "Health Service")
          .replace("Scottish", "Regional")
          .replace("Welsh", "Regional")
          .replace("NI ", "Regional "),
        brief: action.brief
          .replace("NHS", "health service")
          .replace("Scotland", "the regions")
          .replace("Wales", "the regions")
          .replace("Northern Ireland", "the regions"),
        description: action.description
          .replace("NHS", "health service")
          .replace("Exchequer", "national treasury")
          .replace("Scotland", "the regions")
          .replace("Wales", "the regions")
          .replace("Northern Ireland", "the regions")
          .replace("MAFF-era", "agricultural"),
      }))
  );
}

const portfolioActions: readonly ResetCabinetAction[] = [
  ...authored,
  ...localizedActions("IE", ieSeatSources),
  ...localizedActions("SCO", successorSeatSources),
  ...localizedActions("WAL", successorSeatSources),
];

// Intelligence keeps its specialized console; these tasks do not debit its
// budget or duplicate covert operations.
const intelligenceActions: ResetCabinetAction[] = (["US", "UK"] as const).flatMap((country) =>
  authored
    .filter((action) => action.seatId === "chief_cabinet_secretary")
    .map((action) => ({
      ...action,
      id: `${country}:director_of_intelligence:${action.slot}`,
      country,
      seatId: "director_of_intelligence",
      title: action.slot === 1 ? "Publish Oversight Record" : "Review Disaster Liaison",
      brief:
        action.slot === 1
          ? "Publish accountable oversight findings without revealing operational intelligence."
          : "Review the service's documented disaster response assignments.",
      description: action.description.replace("Cabinet decisions", "oversight findings"),
    }))
);

const completePortfolioActions = [...portfolioActions, ...intelligenceActions];

// Every office has two administrative choices even when its legislative account is
// unfunded. Existing paid actions retain their effects and costs.
const administrativeActions: ResetCabinetAction[] = completePortfolioActions
  .filter((action) => action.slot === 1)
  .flatMap((first) => {
    const office = completePortfolioActions.filter(
      (action) => action.country === first.country && action.seatId === first.seatId
    );
    const staff = office.filter((action) => action.costClass === "Staff");
    return office
      .filter((action) => !staff.some((existing) => existing.target === action.target))
      .slice(0, Math.max(0, 2 - staff.length))
      .map((action, index) => ({
        ...action,
        id: `${action.country}:${action.seatId}:${index === 0 ? "staff-review" : "staff-casework"}`,
        slot: 3 + index,
        title: index === 0 ? "Department Delivery Review" : "Department Casework Review",
        strength: Math.min(0.08, action.strength),
        costClass: "Staff" as const,
        brief: `Review existing departmental work on ${action.targetNames.join(" and ")}.`,
        description:
          "Review existing departmental work within the office's portfolio. Uses one shared ministerial charge for 12 turns, with no incremental cash debit. Strength is capped at 0.08 on the first target and half on a second target. Existing office concurrency and target cooldown limits apply. This does not replace legislation, create money, or bypass legal authority.",
      }));
  });

export const resetCabinetActions: readonly ResetCabinetAction[] = [
  ...completePortfolioActions,
  ...administrativeActions,
];

export function resetActionsForSeat(
  country: ResetCountry,
  seatId: string
): readonly ResetCabinetAction[] {
  return resetCabinetActions.filter(
    (action) => action.country === country && action.seatId === seatId
  );
}
