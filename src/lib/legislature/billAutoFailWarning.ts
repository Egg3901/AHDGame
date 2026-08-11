import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Election } from "@/lib/db/types";

const BILL_STAGE_DURATION_MS = 24 * 60 * 60 * 1000;

export type BillProposalOriginChamber =
  "house" | "senate" | "joint" | "commons" | "bundestag" | "shugiin" | "sangiin" | "cabinet";

export interface BillProposalAutoFailWarning {
  countryId: CountryId;
  originChamber: BillProposalOriginChamber;
  originChamberName: string;
  lowerChamberKey: string;
  lowerChamberName: string;
  electionType: string;
  electionName: string;
  electionStatus: "upcoming" | "active";
  electionEndsAt: string;
  lowerChamberExposureStartsAt: string;
  lowerChamberExposureEndsAt: string;
}

interface LowerChamberExposureWindow {
  startsAt: Date;
  endsAt: Date;
  originChamberName: string;
  lowerChamberKey: string;
  lowerChamberName: string;
}

function describeOriginChamber(
  countryId: CountryId,
  originChamber: BillProposalOriginChamber
): string {
  const config = COUNTRY_CONFIGS[countryId];
  if (originChamber === "joint") return "Joint resolution";
  if (originChamber === "cabinet") return "Cabinet bill";
  if (originChamber === config.legislature.lowerChamber.key) {
    return config.legislature.lowerChamber.name;
  }
  if (originChamber === config.legislature.upperChamber?.key) {
    return config.legislature.upperChamber?.name ?? originChamber;
  }
  return originChamber;
}

function getLowerChamberExposureWindow(
  countryId: CountryId,
  originChamber: BillProposalOriginChamber,
  proposedAt: Date
): LowerChamberExposureWindow | null {
  const config = COUNTRY_CONFIGS[countryId];
  const lowerChamberKey = config.legislature.lowerChamber.key;
  const lowerChamberName = config.legislature.lowerChamber.name;
  const originChamberName = describeOriginChamber(countryId, originChamber);

  if (originChamber === lowerChamberKey || originChamber === "joint") {
    return {
      startsAt: proposedAt,
      endsAt: new Date(proposedAt.getTime() + BILL_STAGE_DURATION_MS),
      originChamberName,
      lowerChamberKey,
      lowerChamberName,
    };
  }

  if (originChamber === "senate" || originChamber === "sangiin" || originChamber === "cabinet") {
    return {
      startsAt: new Date(proposedAt.getTime() + BILL_STAGE_DURATION_MS),
      endsAt: new Date(proposedAt.getTime() + BILL_STAGE_DURATION_MS * 2),
      originChamberName,
      lowerChamberKey,
      lowerChamberName,
    };
  }

  return null;
}

function getTrackedLowerChamberElectionTypes(countryId: CountryId): string[] {
  const lowerChamberKey = COUNTRY_CONFIGS[countryId].legislature.lowerChamber.key;
  return [lowerChamberKey, `snap_${lowerChamberKey}`, "snap_lowerChamber"];
}

function describeElectionName(countryId: CountryId, electionType: string): string {
  const config = COUNTRY_CONFIGS[countryId];
  if (electionType === config.legislature.lowerChamber.key) {
    return `${config.legislature.lowerChamber.name} general election`;
  }
  if (
    electionType === `snap_${config.legislature.lowerChamber.key}` ||
    electionType === "snap_lowerChamber"
  ) {
    return `${config.legislature.lowerChamber.name} snap election`;
  }
  return electionType;
}

export async function getBillProposalAutoFailWarning(
  db: Db,
  countryId: CountryId,
  originChamber: BillProposalOriginChamber,
  proposedAt: Date = new Date()
): Promise<BillProposalAutoFailWarning | null> {
  const exposureWindow = getLowerChamberExposureWindow(countryId, originChamber, proposedAt);
  if (!exposureWindow) return null;

  const electionsCollection = db.collection<Election>("elections");
  if (typeof electionsCollection.findOne !== "function") {
    return null;
  }

  const upcomingElection = await electionsCollection.findOne(
    {
      countryId,
      electionType: { $in: getTrackedLowerChamberElectionTypes(countryId) },
      status: { $in: ["upcoming", "active"] },
      endTime: { $gte: proposedAt },
    },
    { sort: { endTime: 1 } }
  );

  if (!upcomingElection?.endTime) return null;

  const electionEndsAt = upcomingElection.endTime;
  if (
    electionEndsAt.getTime() < exposureWindow.startsAt.getTime() ||
    electionEndsAt.getTime() > exposureWindow.endsAt.getTime()
  ) {
    return null;
  }

  return {
    countryId,
    originChamber,
    originChamberName: exposureWindow.originChamberName,
    lowerChamberKey: exposureWindow.lowerChamberKey,
    lowerChamberName: exposureWindow.lowerChamberName,
    electionType: upcomingElection.electionType,
    electionName: describeElectionName(countryId, upcomingElection.electionType),
    electionStatus: upcomingElection.status as "upcoming" | "active",
    electionEndsAt: electionEndsAt.toISOString(),
    lowerChamberExposureStartsAt: exposureWindow.startsAt.toISOString(),
    lowerChamberExposureEndsAt: exposureWindow.endsAt.toISOString(),
  };
}

export function getBillProposalAutoFailWarningError(warning: BillProposalAutoFailWarning): string {
  return `The next ${warning.electionName} is expected to finalize while this proposal would still be in the ${warning.lowerChamberName}. Bills still in that chamber automatically fail when the election resolves.`;
}
