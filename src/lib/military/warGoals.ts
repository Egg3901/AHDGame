/**
 * What a war is declared FOR.
 *
 * Recorded on the conflict so peace terms have something to negotiate over — "what
 * were you fighting for" is the question a peace deal answers. Retrofitting a goal
 * onto wars already in progress would be far more expensive than carrying one from
 * the start.
 *
 * Spec: docs/superpowers/specs/2026-08-04-war-declaration-legislation-design.md
 */
/**
 * Turns a country must wait between filing war declarations.
 *
 * Counted from the last PROPOSAL, not the last passage: a declaration the
 * chambers threw out still spent the country's diplomatic capital. One turn is
 * one hour, so this is roughly five in-game days.
 */
export const WAR_DECLARATION_COOLDOWN_TURNS = 120;

export type WarGoal = "conquest" | "regime_change" | "punitive" | "liberation";

export interface WarGoalOption {
  id: WarGoal;
  label: string;
  blurb: string;
  /**
   * False for goals that exist in the type but cannot yet be chosen.
   *
   * The picker disables them and the bill validator rejects them, BOTH from this
   * list. Disabling the option alone would be cosmetic — the provision arrives as
   * JSON over the cabinet-bills API, so a hand-rolled request could still submit a
   * reserved goal. One source of truth is what stops the two drifting when a goal
   * is switched on later.
   */
  selectable: boolean;
}

export const WAR_GOALS: readonly WarGoalOption[] = [
  {
    id: "conquest",
    label: "Conquest",
    // Reserved: nothing transfers territory yet, so a war fought for conquest could
    // not actually be won. Switched on when annexation exists.
    blurb: "Take and hold enemy territory. Not yet available.",
    selectable: false,
  },
  {
    id: "regime_change",
    label: "Regime Change",
    blurb: "Force a change of government in the defending country.",
    selectable: true,
  },
  {
    id: "punitive",
    label: "Punitive",
    blurb: "Extract concessions by force, then withdraw.",
    selectable: true,
  },
  {
    id: "liberation",
    label: "Liberation",
    blurb: "Free territory or an ally held by the defender.",
    selectable: true,
  },
] as const;

/** True only for goals a player may actually choose today. */
export function isSelectableWarGoal(id: string): id is WarGoal {
  return WAR_GOALS.some((g) => g.id === id && g.selectable);
}

/**
 * Display label for a goal. Conflicts created before declarations existed carry no
 * goal, so the fallback keeps the record page from printing a raw id or "undefined".
 */
export function warGoalLabel(id: WarGoal | undefined | null): string {
  return WAR_GOALS.find((g) => g.id === id)?.label ?? "Undeclared";
}
