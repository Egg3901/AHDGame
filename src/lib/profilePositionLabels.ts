import type { CountryId } from "@/lib/constants/countries";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { resolveSeatName } from "@/lib/cabinet/rosterEra";
import { LEADERSHIP_ROLE_LABEL } from "@/lib/congress/leadership/electionRoleMap";
import type { LeadershipRole } from "@/lib/db/types";
import { CONGRESS_LEADER_NI_BONUS } from "@/lib/actions/positionNiBonus";

interface ProfileCabinetPosition {
  countryId: CountryId;
  positionId: string;
  acting?: boolean;
}

interface ProfilePositionLabelsInput {
  baseOfficeLabel: string;
  hasBaseOffice: boolean;
  congressLeadershipRoles?: readonly LeadershipRole[];
  cabinetPositions?: readonly ProfileCabinetPosition[];
  gameYear?: number | null;
  enabledCabinetSeats?: readonly string[];
}

/**
 * Build the ordered public-office chips shown on a character profile.
 * Leadership and cabinet duties add context without hiding the underlying seat.
 */
export function resolveProfilePositionLabels({
  baseOfficeLabel,
  hasBaseOffice,
  congressLeadershipRoles = [],
  cabinetPositions = [],
  gameYear = null,
  enabledCabinetSeats = [],
}: ProfilePositionLabelsInput): string[] {
  const leadershipRoles = [...new Set(congressLeadershipRoles)].sort((left, right) => {
    const tierDifference =
      (CONGRESS_LEADER_NI_BONUS[right] ?? 0) - (CONGRESS_LEADER_NI_BONUS[left] ?? 0);
    return (
      tierDifference || LEADERSHIP_ROLE_LABEL[left].localeCompare(LEADERSHIP_ROLE_LABEL[right])
    );
  });

  const labels = leadershipRoles.map((role) => LEADERSHIP_ROLE_LABEL[role]);
  const enabledSeatIds = new Set(enabledCabinetSeats);

  const cabinetLabels = cabinetPositions
    .map((cabinetPosition) => {
      const positions = getCabinetPositions(cabinetPosition.countryId);
      const position = positions.find((candidate) => candidate.id === cabinetPosition.positionId);
      const positionName = position
        ? resolveSeatName(position, gameYear, enabledSeatIds)
        : "Cabinet Member";
      return {
        countryId: cabinetPosition.countryId,
        order: position?.order ?? Number.MAX_SAFE_INTEGER,
        label: cabinetPosition.acting ? `Acting ${positionName}` : positionName,
      };
    })
    .sort(
      (left, right) =>
        left.countryId.localeCompare(right.countryId) ||
        left.order - right.order ||
        left.label.localeCompare(right.label)
    );
  labels.push(...cabinetLabels.map(({ label }) => label));

  if (hasBaseOffice || labels.length === 0) {
    labels.push(baseOfficeLabel);
  }
  return [...new Set(labels)];
}
