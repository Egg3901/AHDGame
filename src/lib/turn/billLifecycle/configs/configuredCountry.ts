import {
  getCountryConfig,
  getExecutiveOfficeKey,
  isPresidentialGovernmentType,
  type CountryId,
  type CountryConfig,
} from "@/lib/constants/countries";
import {
  getVotingUpperChamberKey,
  resolveCountryOfficeLayout,
} from "@/lib/countries/rules/officeLayout";
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
  preset?: string,
  runtimeCountry?: CountryConfig
): BillLifecycleConfig {
  const country = runtimeCountry ?? getCountryConfig(countryId, preset);
  if (country.id !== countryId) throw new Error("Bill lifecycle country snapshot disagrees");
  const offices = resolveCountryOfficeLayout(country);
  const lowerChamber = country.legislature.lowerChamber.key;
  const upperOfficeType = runtimeCountry
    ? offices.upperOfficeType
    : getUpperChamberOfficeType(countryId, preset);
  const upperChamber = upperOfficeType ? country.legislature.upperChamber?.key : undefined;
  const hasVotingUpperChamber = Boolean(upperChamber && getVotingUpperChamberKey(country));
  const hasPresidentialAction =
    isPresidentialGovernmentType(country.governmentType) ||
    (runtimeCountry !== undefined &&
      offices.headOfStateOfficeType === "president" &&
      country.headOfStateSelection !== "legislatureAppointment");
  const officeTypeFor = (bill: {
    currentChamber: string;
    originChamber?: string;
    preset?: string;
  }) =>
    runtimeCountry
      ? [lowerChamber, offices.lowerOfficeType].includes(
          bill.currentChamber || bill.originChamber || ""
        )
        ? offices.lowerOfficeType
        : [upperChamber, offices.upperOfficeType].includes(
              bill.currentChamber || bill.originChamber || ""
            )
          ? (offices.upperOfficeType ?? "")
          : ""
      : getOfficeTypeForChamber(countryId, bill.currentChamber, bill.preset ?? preset);

  const finalVoteStatus = hasPresidentialAction ? "enrolled" : "signed";
  const stages: BillStage[] = [
    {
      kind: "chamberVote",
      status: "active",
      voteField: "votes",
      officeTypeFor,
      passRule: "simpleMajority",
      onReject: "fail",
      onPassStatus: hasVotingUpperChamber ? "active_other" : finalVoteStatus,
      execActionCheckOnPass: hasPresidentialAction,
      votingDurationHours: VOTING_HOURS,
    },
  ];

  if (hasVotingUpperChamber && upperChamber) {
    stages.push({
      kind: "chamberVote",
      status: "active_other",
      voteField: "otherChamberVotes",
      officeTypeFor,
      passRule: "simpleMajority",
      onReject: "fail",
      onPassStatus: finalVoteStatus,
      votingDurationHours: VOTING_HOURS,
      chamberOnEnter: (bill) =>
        [lowerChamber, offices.lowerOfficeType].includes(bill.currentChamber)
          ? upperChamber
          : lowerChamber,
      execActionCheckOnPass: hasPresidentialAction,
    });
  }

  if (hasPresidentialAction) {
    stages.push({
      kind: "executiveAction",
      status: "enrolled",
      execKind: "presidentVeto",
      officeType: runtimeCountry
        ? (offices.headOfStateOfficeType ?? getExecutiveOfficeKey(countryId, preset))
        : getExecutiveOfficeKey(countryId, preset),
      windowHours: EXECUTIVE_ACTION_HOURS,
      onTimeout: "sign",
    });
  }

  stages.push(
    runtimeCountry
      ? {
          ...CONCURRENT_VOTE_STAGE,
          chambersFor: () => offices.jointSittingOfficeTypes,
          voteFieldFor: (_bill, officeType) =>
            officeType === offices.lowerOfficeType ? "votes" : "otherChamberVotes",
        }
      : CONCURRENT_VOTE_STAGE
  );
  if (runtimeCountry && hasPresidentialAction)
    stages.push({
      kind: "override",
      status: "veto_override",
      threshold: "twoThirdsSeats",
      chambers: offices.jointSittingOfficeTypes,
      votingDurationHours: VOTING_HOURS,
    });

  return {
    country: countryId,
    governmentType: country.governmentType,
    hasPresidentialExecutive: hasPresidentialAction,
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
