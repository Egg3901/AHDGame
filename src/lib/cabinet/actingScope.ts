/**
 * Cabinet route classifications. Acting holders have the same authority as confirmed
 * holders; appointment duration and charges remain bounded by the portable rules.
 */
export * from "./rules";
import type { CabinetLeverScope } from "./rules";

/** Mutating cabinet routes by capability, checked by actingScope.manifest.test.ts. */
export const CABINET_ROUTE_SCOPES: Record<string, CabinetLeverScope | "operational"> = {
  "military/recruit": "operational",
  "military/[unitId]": "operational",
  "military/[unitId]/assign": "operational",
  "military/[unitId]/posture": "operational",
  "military/[unitId]/upgrade": "operational",
  "military/assign-branch": "operational",
  formations: "operational",
  theaters: "operational",
  commands: "operational",
  "battle/declare": "operational",
  "battle/auto-join": "operational",
  "navair/mission": "operational",
  manpower: "operational",
  order: "operational",
  banner: "operational",
  "infra/[projectId]/funding": "operational",
  "estates/[estateId]/fund": "operational",
  allocation: "operational",
  "department-allocation": "operational",
  "reset-action": "operational",

  setting: "stance",

  generals: "personnel",
  "generals/[characterId]": "personnel",

  "doctrine/adopt": "doctrine",
  "nuclear/adopt": "doctrine",
  "nuclear/covert/breakout": "doctrine",
  "nuclear/covert/funding": "doctrine",
  "nuclear/production": "doctrine",
  "nuclear/test": "doctrine",

  "intelligence/counter-intel": "stance",
  "intelligence/network": "stance",
  "intelligence/operation": "stance",

  "defence-contracts": "procurement",
  "debt-operation": "treasury",
  "bond-profile": "treasury",

  "estates/open": "assets",
  "estates/[estateId]/expand": "assets",
  "estates/[estateId]": "assets",
  "infra/start": "assets",
  "infra/[projectId]": "assets",
  "energy/build": "assets",
  "energy/[plantId]": "assets",
  "energy/[plantId]/upgrade": "assets",
};
