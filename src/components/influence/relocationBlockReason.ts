export interface RelocationTargetOption {
  id: string;
  name: string;
  currentNPPs: number;
  maxSlots: number;
  full: boolean;
  /** False when the party has no presence in or next to this region. */
  inFrontier?: boolean;
}

export interface RelocationBlockInput {
  /** Every region except the one the NPP currently lives in. */
  targetOptions: RelocationTargetOption[];
  /** The region currently chosen in the picker, if any. */
  selectedTargetId: string;
  /** Lowercased country-specific region word ("state", "region", "oblast"). */
  regionLabelLower: string;
}

/**
 * Why a relocation cannot be submitted right now, in words the player can act
 * on — or `null` when nothing is blocking it.
 *
 * The picker already disabled full targets, but a disabled `<option>` explains
 * nothing and, when every region was full, the dropdown was a list of dead
 * entries with no message anywhere on the page. That is what "it's not letting
 * me relocate my London NPP to the south east" looked like from the player's
 * side. Same treatment as the union organize drive: name the wall before the
 * click, not after.
 */
export function getRelocationBlockReason({
  targetOptions,
  selectedTargetId,
  regionLabelLower,
}: RelocationBlockInput): string | null {
  if (targetOptions.length === 0) return null;

  // Growth frontier first: it is a harder wall than capacity, and a region that
  // is out of reach would otherwise be reported as merely "at capacity".
  if (targetOptions.every((option) => option.inFrontier === false)) {
    return `No other ${regionLabelLower} is within your party's reach. A politician can only move to a ${regionLabelLower} your party already holds or one next to it.`;
  }

  const selectedOutOfReach = targetOptions.find(
    (option) => option.id === selectedTargetId && option.inFrontier === false
  );
  if (selectedOutOfReach) {
    return `${selectedOutOfReach.name} is outside your party's reach. Pick a ${regionLabelLower} your party already holds or one next to it.`;
  }

  if (targetOptions.every((option) => option.full)) {
    return `Every other ${regionLabelLower} is at capacity for your party. Build your party organization somewhere else first, or move a politician out of the target ${regionLabelLower}.`;
  }

  const selected = targetOptions.find((option) => option.id === selectedTargetId);
  if (selected?.full) {
    return `${selected.name} is at capacity for your party (${selected.currentNPPs}/${selected.maxSlots} politicians). Pick another ${regionLabelLower}, or build your party organization there.`;
  }

  return null;
}
