import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import type { CabinetPositionMechanics } from "@/lib/constants/cabinetMechanicsTypes";

export type CabinetTabId =
  "overview" | "treasury" | "foreign" | "flagship" | "commands" | "doctrine";

export interface CabinetTab {
  id: CabinetTabId;
  label: string;
}

/**
 * Foreign-affairs seats that get the Foreign Relations tab. Kept to exactly the
 * three seats the pre-redesign page surfaced foreign panels for (US/UK/JP), so
 * the shell re-homes existing behavior without silently enabling the panel for
 * CN/IE/DE foreign ministers (whose foreign-setting API gating is unverified —
 * a deliberate change for the Foreign sub-project, not the visual shell).
 */
const FOREIGN_POSITION_IDS = new Set([
  "foreign_secretary",
  "secretary_of_state",
  "foreign_affairs_minister",
]);

// Derived from the one defense-seat map so a country's registered position id is
// automatically recognized as a defense seat — no second hardcoded list to drift.
const DEFENSE_POSITION_IDS = new Set(
  Object.values(DEFENSE_POSITION_BY_COUNTRY).filter((id): id is string => id !== null)
);

export function isFinanceMinister(countryId: string, positionId: string): boolean {
  return COUNTRY_CONFIGS[countryId as CountryId]?.financeMinisterCabinetId === positionId;
}

export function isDefenseMinister(positionId: string): boolean {
  return DEFENSE_POSITION_IDS.has(positionId);
}

export function isForeignMinister(positionId: string): boolean {
  return FOREIGN_POSITION_IDS.has(positionId);
}

export function resolveCabinetTabs(args: {
  countryId: string;
  positionId: string;
  mechanics: CabinetPositionMechanics;
  /** Gates the defense-only Commands + Doctrine tabs behind the Conflicts subsystem. */
  conflictsEnabled?: boolean;
}): CabinetTab[] {
  const { countryId, positionId, conflictsEnabled = false } = args;
  const tabs: CabinetTab[] = [{ id: "overview", label: "Overview" }];

  if (isFinanceMinister(countryId, positionId)) {
    tabs.push({ id: "treasury", label: "Treasury" });
  }
  if (isForeignMinister(positionId)) {
    tabs.push({ id: "foreign", label: "Foreign Relations" });
  }

  tabs.push({
    id: "flagship",
    label: isDefenseMinister(positionId)
      ? "Military"
      : isFinanceMinister(countryId, positionId)
        ? "Monetary"
        : "Programs",
  });

  // Defense seats gain Commands + Doctrine when the Conflicts subsystem is enabled.
  if (isDefenseMinister(positionId) && conflictsEnabled) {
    tabs.push({ id: "commands", label: "Commands" });
    tabs.push({ id: "doctrine", label: "Doctrine" });
  }

  return tabs;
}

export function seatIconName(positionId: string, mechanics: CabinetPositionMechanics): string {
  if (isDefenseMinister(positionId)) return "shield";
  if (isForeignMinister(positionId)) return "globe";
  const cat = mechanics.nationalMetrics[0]?.category;
  const byCat: Record<string, string> = {
    economic: "coin",
    governance: "scale",
    social: "users",
    energy: "bolt",
    environment: "leaf",
    infrastructure: "road",
  };
  return (cat && byCat[cat]) || "briefcase";
}
