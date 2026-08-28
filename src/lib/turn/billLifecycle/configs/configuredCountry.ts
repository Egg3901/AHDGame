import {
  getCountryConfig,
  getExecutiveOfficeKey,
  isPresidentialGovernmentType,
  type CountryId,
} from "@/lib/constants/countries";
import {
  getOfficeTypeForChamber,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import type { BillLifecycleConfig, BillStage } from "../types";
import { CONCURRENT_VOTE_STAGE } from "./concurrentVoteStage";

const VOTING_HOURS = 24;
const EXECUTIVE_ACTION_HOURS = 10;

/**
 * Build the ordinary national lifecycle for a configured country and era.
 *
 * These countries share the same mechanical graph. A bill starts in the lower
 * chamber, advances through an elected upper chamber when one exists, and then
 * either enacts or enters a presidential action window. The country's authored
 * legislature remains the source of truth, including the era-dependent Spanish
 * and Turkish chamber shapes.
 */
export function buildConfiguredCountryBillLifecycle(
  countryId: CountryId,
  preset?: string
): BillLifecycleConfig {
  const country = getCountryConfig(countryId, preset);
  const lowerChamber = country.legislature.lowerChamber.key;
  const upperOfficeType = getUpperChamberOfficeType(countryId, preset);
  const upperChamber = upperOfficeType ? country.legislature.upperChamber?.key : undefined;
  const hasElectedUpperChamber = Boolean(upperChamber && country.upperElectionSystem);
  const hasPresidentialAction = isPresidentialGovernmentType(country.governmentType);

  const finalVoteStatus = hasPresidentialAction ? "enrolled" : "signed";
  const stages: BillStage[] = [
    {
      kind: "chamberVote",
      status: "active",
      voteField: "votes",
      officeTypeFor: (bill) =>
        getOfficeTypeForChamber(countryId, bill.currentChamber, bill.preset ?? preset),
      passRule: "simpleMajority",
      onReject: "fail",
      onPassStatus: hasElectedUpperChamber ? "active_other" : finalVoteStatus,
      votingDurationHours: VOTING_HOURS,
    },
  ];

  if (hasElectedUpperChamber && upperChamber) {
    stages.push({
      kind: "chamberVote",
      status: "active_other",
      voteField: "otherChamberVotes",
      officeTypeFor: (bill) =>
        getOfficeTypeForChamber(countryId, bill.currentChamber, bill.preset ?? preset),
      passRule: "simpleMajority",
      onReject: "fail",
      onPassStatus: finalVoteStatus,
      votingDurationHours: VOTING_HOURS,
      chamberOnEnter: (bill) =>
        bill.currentChamber === lowerChamber ? upperChamber : lowerChamber,
      execActionCheckOnPass: hasPresidentialAction,
    });
  }

  if (hasPresidentialAction) {
    stages.push({
      kind: "executiveAction",
      status: "enrolled",
      execKind: "presidentVeto",
      officeType: getExecutiveOfficeKey(countryId, preset),
      windowHours: EXECUTIVE_ACTION_HOURS,
      onTimeout: "sign",
    });
  }

  stages.push(CONCURRENT_VOTE_STAGE);

  return {
    country: countryId,
    level: "national",
    originChambers: [
      lowerChamber,
      ...(country.legislature.upperChamber ? [country.legislature.upperChamber.key] : []),
      "joint",
    ],
    skipWhenGovPending: true,
    activateProposed: true,
    stages,
  };
}
