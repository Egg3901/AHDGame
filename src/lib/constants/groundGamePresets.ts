export type PresetEffect = "mobilize" | "persuade";

export interface GroundGamePreset {
  id: string;
  label: string;
  effect: PresetEffect;
  /** persuade: whole-electorate aggregate pp swing (== the displayed label). */
  leanSwing?: number;
  /** mobilize: turnout units pushed onto a fully-aligned cohort at whole scale. */
  turnoutPush?: number;
  /** Representative whole-electorate pp for the card UI (mobilize varies by base). */
  nominalSwing: number;
  funds: number; // home-currency Campaign Funds (volunteer)
  actions: number; // character.actions (volunteer)
  ps: number; // Political Strength (official)
}

export const GROUND_GAME_PRESETS: GroundGamePreset[] = [
  {
    id: "press_conference",
    label: "Press conference",
    effect: "persuade",
    leanSwing: 0.5,
    nominalSwing: 0.5,
    funds: 40_000,
    actions: 1,
    ps: 2,
  },
  {
    id: "doorstep_canvass",
    label: "Doorstep canvass",
    effect: "mobilize",
    turnoutPush: 5,
    nominalSwing: 1.2,
    funds: 90_000,
    actions: 1,
    ps: 3,
  },
  {
    id: "gotv_drive",
    label: "Get-out-the-vote drive",
    effect: "mobilize",
    turnoutPush: 8,
    nominalSwing: 1.9,
    funds: 220_000,
    actions: 2,
    ps: 5,
  },
  {
    id: "broadcast_ads",
    label: "Broadcast & digital ads",
    effect: "persuade",
    leanSwing: 1.5,
    nominalSwing: 1.5,
    funds: 380_000,
    actions: 2,
    ps: 8,
  },
  {
    id: "mass_rally",
    label: "Mass rally",
    effect: "mobilize",
    turnoutPush: 13,
    nominalSwing: 3.1,
    funds: 620_000,
    actions: 3,
    ps: 12,
  },
];

export function findGroundGamePreset(id: string): GroundGamePreset | undefined {
  return GROUND_GAME_PRESETS.find((p) => p.id === id);
}
