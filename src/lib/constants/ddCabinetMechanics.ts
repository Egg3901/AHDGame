/**
 * East Germany (DD) Cabinet mechanics — Council of Ministers of the GDR.
 *
 * DD's cabinet is a command-economy Council of Ministers structurally identical
 * to the USSR's (same portfolios and policy levers: the planning-commission
 * chair, the central-bank liaison, and the Finance / Foreign-Trade / Internal-
 * Trade / Agriculture tier settings). DD's cabinet position IDs mirror RU's
 * one-for-one (see ddCabinet.ts), so we reuse RU_CABINET_MECHANICS verbatim,
 * remapping only the head-of-government key (RU `premier` → DD `generalSecretary`,
 * DD's executive office key). This keeps DD in lock-step with the RU mechanics
 * that ruCabinetEffectPaths.test.ts pins, instead of duplicating 400 lines that
 * would drift.
 *
 * Departments are the one thing DD does NOT inherit: RU's strings name Soviet
 * institutions, which leaked into the GDR council (the Staatsbank liaison read
 * "State Bank of the USSR", the Transport Minister read "Ministry of Railways").
 * DD_DEPARTMENTS overrides those per seat; the levers themselves stay shared.
 * Pinned by ddCabinetMechanics.test.ts.
 */
import type { CabinetPositionMechanics } from "./cabinetMechanicsTypes";
import { RU_CABINET_MECHANICS } from "./ruCabinetMechanics";

const { premier, ...sharedCouncilMechanics } = RU_CABINET_MECHANICS;

/** GDR-authentic department strings, keyed by the shared position id. */
const DD_DEPARTMENTS: Record<string, string> = {
  minister_of_defence: "Ministry of National Defence",
  minister_of_internal_affairs: "Ministry of Internal Affairs",
  director_of_intelligence: "Ministry for State Security",
  chairman_of_gosplan: "State Planning Commission",
  gosbank_liaison: "Staatsbank der DDR",
  minister_of_internal_trade: "Ministry of Trade and Supply",
  minister_of_agriculture: "Ministry of Agriculture, Forestry and Food",
  minister_of_machine_building: "Ministry of Heavy Industry and Machine Building",
  minister_of_railways: "Ministry of Transport",
  minister_of_higher_education: "Ministry of Higher and Technical Education",
};

/**
 * Era bands for departments whose name changed mid-span. Mirrors the 1968
 * Deutsche Notenbank → Staatsbank rename already carried on the seat NAME in
 * ddCabinet.ts, so the office header and the rail agree in every year.
 */
const DD_DEPARTMENT_BANDS: Record<string, ReadonlyArray<{ from: number; name: string }>> = {
  gosbank_liaison: [
    { from: 1775, name: "Deutsche Notenbank" },
    { from: 1968, name: "Staatsbank der DDR" },
  ],
};

function withDdDepartment(mech: CabinetPositionMechanics): CabinetPositionMechanics {
  const department = DD_DEPARTMENTS[mech.positionId];
  const departmentByYear = DD_DEPARTMENT_BANDS[mech.positionId];
  if (!department && !departmentByYear) return mech;
  return {
    ...mech,
    ...(department ? { department } : {}),
    ...(departmentByYear ? { departmentByYear } : {}),
  };
}

export const DD_CABINET_MECHANICS: Record<string, CabinetPositionMechanics> = Object.fromEntries(
  Object.entries({
    generalSecretary: { ...premier, positionId: "generalSecretary" },
    ...sharedCouncilMechanics,
  }).map(([id, mech]) => [id, withDdDepartment(mech)])
);
