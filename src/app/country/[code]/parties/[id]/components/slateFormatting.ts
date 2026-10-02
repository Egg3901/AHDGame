import { ELECTION_TYPE_LABEL_MAP, isByElectionType } from "@/lib/utils/electionLabels";

/**
 * Label formatting shared by the Slate tab and its assignment picker. Lives
 * apart from both so the picker does not have to import the tab that renders
 * it.
 */
export function formatSlateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export interface SlateRaceTitleInput {
  electionType: string;
  senateClass?: number | null;
  chamberClass?: number | null;
}

/**
 * Title for one race on the slate board, e.g. "Senate Race · Class I". A
 * by-election reads by its game name ("Commons By-Election") rather than its
 * storage key, which rendered as "Special Commons Race" and was hard to tell
 * apart from the region's regular race (ticket 1379).
 */
export function formatSlateRaceTitle(item: SlateRaceTitleInput): string {
  if (isByElectionType(item.electionType)) {
    const label = ELECTION_TYPE_LABEL_MAP[item.electionType];
    if (label) return label;
  }
  const baseLabel = formatSlateLabel(item.electionType);
  const chamberClass = item.senateClass ?? item.chamberClass;
  if (!chamberClass) {
    return `${baseLabel} Race`;
  }

  return `${baseLabel} Race · Class ${toRomanNumeral(chamberClass)}`;
}

function toRomanNumeral(value: number): string {
  switch (value) {
    case 1:
      return "I";
    case 2:
      return "II";
    case 3:
      return "III";
    default:
      return String(value);
  }
}
