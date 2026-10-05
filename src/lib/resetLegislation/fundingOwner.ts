/**
 * Reset-law funding seats at the 1991 start. An owner receives the bill's
 * allocation; it does not inherit an independent regulator's legal powers.
 * Regional laws spend from the regional budget and have no Cabinet seat.
 */
import type { LawFamilyDefinition } from "./catalog";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { resolveDepartment } from "@/lib/cabinet/rosterEra";

export type ResetCountry = "US" | "UK" | "JP";

const SEATS = {
  FIN: { US: "secretary_of_treasury", UK: "chancellor", JP: "finance_minister" },
  LAB: { US: "secretary_of_labor", UK: "work_secretary", JP: "health_minister" },
  ECO: { US: "secretary_of_commerce", UK: "business_secretary", JP: "economy_minister" },
  EDU: { US: "secretary_of_health", UK: "education_secretary", JP: "education_minister" },
  SCI: { US: "secretary_of_commerce", UK: "education_secretary", JP: "education_minister" },
  HLT: { US: "secretary_of_health", UK: "health_secretary", JP: "health_minister" },
  SOC: { US: "secretary_of_health", UK: "work_secretary", JP: "health_minister" },
  HOU: { US: "secretary_of_hud", UK: "levelling_secretary", JP: "land_minister" },
  TRN: { US: "secretary_of_transportation", UK: "transport_secretary", JP: "land_minister" },
  COM: { US: "secretary_of_commerce", UK: "business_secretary", JP: "internal_affairs_minister" },
  ENE: { US: "secretary_of_energy", UK: "business_secretary", JP: "economy_minister" },
  ENV: { US: "secretary_of_interior", UK: "levelling_secretary", JP: "environment_minister" },
  AGR: { US: "secretary_of_agriculture", UK: "agriculture_secretary", JP: "health_minister" },
  JUS: { US: "attorney_general", UK: "home_secretary", JP: "justice_minister" },
  GOV: { US: "attorney_general", UK: "first_secretary_of_state", JP: "internal_affairs_minister" },
  DEF: { US: "secretary_of_defense", UK: "defence_secretary", JP: "defense_minister" },
} as const;

export type ResetOwnerCode = keyof typeof SEATS;

export function fundingSeatForLaw(
  law: Pick<LawFamilyDefinition, "id" | "ownerCode">,
  country: ResetCountry,
  enabledSeats: ReadonlySet<string> = new Set()
): string {
  if (!(law.ownerCode in SEATS)) throw new Error(`Unknown reset owner ${law.ownerCode}`);
  const code = law.ownerCode as ResetOwnerCode;
  if (country === "US") {
    if (law.id === "L50") return "secretary_of_treasury"; // ATF in the 1991 Treasury.
    if (code === "EDU" && enabledSeats.has("secretary_of_education")) {
      return "secretary_of_education";
    }
  }
  if (country === "UK") {
    if (law.id === "L21" || law.id === "L38") return "health_secretary";
    if (law.id === "L36") return "justice_secretary";
  }
  return SEATS[code][country];
}

/** 1991 names, including compressed game seats whose canonical label is modern. */
export function fundingNameForLaw1991(
  law: Pick<LawFamilyDefinition, "id" | "ownerCode">,
  country: ResetCountry,
  enabledSeats: ReadonlySet<string> = new Set()
): string {
  const seatId = fundingSeatForLaw(law, country, enabledSeats);
  if (country === "US") {
    if (law.id === "L50") return "Department of the Treasury (ATF funding)";
    if (seatId === "secretary_of_health" && !enabledSeats.has("secretary_of_education")) {
      return "Department of Health, Education, and Welfare";
    }
  }
  if (country === "JP") {
    const labels: Record<string, string> = {
      finance_minister: "Ministry of Finance",
      health_minister: "Ministry of Health and Welfare",
      economy_minister: "Ministry of International Trade and Industry",
      education_minister: "Ministry of Education, Science and Culture",
      land_minister: law.ownerCode === "TRN" ? "Ministry of Transport" : "Ministry of Construction",
      internal_affairs_minister:
        law.ownerCode === "COM"
          ? "Ministry of Posts and Telecommunications"
          : "Ministry of Home Affairs",
      environment_minister: "Environment Agency",
      defense_minister: "Defense Agency",
      justice_minister: "Ministry of Justice",
    };
    if (labels[seatId]) return labels[seatId];
  }
  if (country === "UK" && seatId === "transport_secretary") return "Department of Transport";
  const mechanics = getCabinetMechanics(country, seatId);
  if (!mechanics) throw new Error(`No Cabinet mechanics for ${country} ${seatId}`);
  return resolveDepartment(mechanics, 1991);
}
