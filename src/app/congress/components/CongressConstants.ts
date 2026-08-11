// Chamber hero: interior of each chamber (Wikimedia Commons — public domain / CC).
// Titles are de-prefixed to match the shared label authority + COUNTRY_CONFIGS.US
// chamber names ("Senate" / "House of Representatives").
export const CHAMBER_HERO = {
  senate: {
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Old_Senate_chambers_US_Capitol.jpg/1280px-Old_Senate_chambers_US_Capitol.jpg",
    title: "Senate",
    tagline: "100 senators, six-year terms. Confirms judges and cabinet.",
    alt: "Old Senate Chamber interior, United States Capitol.",
  },
  house: {
    image:
      "https://upload.wikimedia.org/wikipedia/commons/9/90/United_States_House_of_Representatives_chamber.jpg",
    title: "House of Representatives",
    tagline: "435 reps, two-year terms. All money bills start here.",
    alt: "House of Representatives chamber interior, United States Capitol.",
  },
} as const;

export const LEADER_BADGE_SHORT: Record<string, string> = {
  speaker_of_the_house: "Speaker",
  majority_leader_house: "Maj. Leader",
  minority_leader_house: "Min. Leader",
  majority_whip_house: "Maj. Whip",
  minority_whip_house: "Min. Whip",
  president_pro_tempore: "Pro Tempore",
  majority_leader_senate: "Maj. Leader",
  minority_leader_senate: "Min. Leader",
  majority_whip_senate: "Maj. Whip",
  minority_whip_senate: "Min. Whip",
};

export const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  active: "Voting Open",
  passed_origin: "Passed Chamber",
  active_other: "2nd Chamber",
  enrolled: "Awaiting President",
  cabinet_review: "Cabinet Review",
  override_shugiin: "Shugiin Override",
  signed: "Signed",
  vetoed: "Vetoed",
  failed: "Failed",
  withdrawn: "Withdrawn",
  veto_override: "Override Vote",
  override_failed: "Override Failed",
};

export type ChamberTab = "senate" | "house";
export type PageTab =
  "composition" | "bills" | "leadership" | "tariffs" | "subsidies" | "contracts";
export type SenateClassFilter = 0 | 1 | 2 | 3;

/** Convert senate class number (1-3) to Roman numeral (I, II, III) */
export function getSenateClassLabel(classNum: number | null | undefined): string {
  if (!classNum || classNum < 1 || classNum > 3) return "";
  return ["I", "II", "III"][classNum - 1];
}

export type LeaderStrip = {
  role: string;
  label: string;
  chamber: "house" | "senate";
  characterId: string | null;
  /** Sequential ID for stable URLs (prefer this over characterId) */
  sequentialId: number | null;
  characterName: string;
  isVacant: boolean;
  isNPP: boolean;
};
