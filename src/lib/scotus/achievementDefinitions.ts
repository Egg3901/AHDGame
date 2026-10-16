/**
 * Supreme Court achievement definitions. One source for the seed list and the
 * startup migration that adds them to worlds that already seeded achievements.
 */
export const SCOTUS_CONFIRMED_SLUG = "supreme_court_justice";
export const SCOTUS_DIED_IN_OFFICE_SLUG = "died_in_office_justice";

export const SCOTUS_ACHIEVEMENTS = [
  {
    slug: SCOTUS_CONFIRMED_SLUG,
    name: "Equal Justice Under Law",
    description: "Confirmed to the Supreme Court",
    icon: "Scale",
    category: "election" as const,
    triggerType: "scotus_confirmed",
    isHidden: false,
    order: 71,
  },
  {
    slug: SCOTUS_DIED_IN_OFFICE_SLUG,
    name: "Served for Life",
    description: "Died in office while serving as a Supreme Court Justice",
    icon: "Hourglass",
    category: "special" as const,
    triggerType: "scotus_died_in_office",
    isHidden: false,
    order: 72,
  },
] as const;
