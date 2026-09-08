/**
 * Military command assignments refer to units in the country's current roster.
 * reconcileCommandUnits drops missing references while retaining command settings
 * and all available units, so a removed unit cannot block command saves.
 */
export function reconcileCommandUnits<T extends { unitIds: string[] }>(
  commands: T[],
  availableUnitIds: readonly string[]
): T[] {
  const available = new Set(availableUnitIds);
  let changed = false;
  const reconciled = commands.map((command) => {
    const unitIds = command.unitIds.filter((id) => available.has(id));
    if (unitIds.length === command.unitIds.length) return command;
    changed = true;
    return { ...command, unitIds };
  });
  return changed ? reconciled : commands;
}
