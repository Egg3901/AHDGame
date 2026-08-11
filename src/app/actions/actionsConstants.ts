import { formatFundsCompact } from "@/lib/utils/formatters";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import type { ActionCard } from "./actionsTypes";

export const CARDS: ActionCard[] = [
  {
    type: "campaign",
    label: "Campaign",
    tagline: "Take to the streets",
    flavor:
      "Town halls, handshakes, precinct walks. The grassroots support that no advertising budget can manufacture — built one voter at a time.",
    actionCost: 1,
    fundCost: () => null,
    fundLabel: () => "Loading…",
    effect: "+1% Political Influence",
    imageSlug: "campaign",
    imageAlt: "Candidate campaigning before a crowd",
    category: "influence",
  },
  {
    type: "advertise",
    label: "Run Advertisements",
    tagline: "Own the airwaves",
    flavor:
      "Hoardings, handbills, and paid airtime. When your name is on every corner, voters remember it on polling day.",
    actionCost: 5,
    fundCost: () => null,
    fundLabel: () => "Loading…",
    effect: "+3% Favorability, less as you climb",
    effectNote:
      "Charisma scales the gain, and it tapers once you pass 70% favorability. It never drops below +1.",
    imageSlug: "advertise",
    imageAlt: "Street advertising and campaign hoardings",
    category: "influence",
  },
  {
    type: "fundraise",
    label: "Fundraise",
    tagline: "Work the room",
    flavor:
      "Your network picks up the telephone. The cheques follow. A formidable war chest doesn't just fund campaigns — it keeps opponents from running.",
    actionCost: 3,
    fundCost: () => null,
    fundLabel: (c) => `+${formatFundsCompact(50_000 + (c.donorBaseLevel ?? 0) * 2_000)}`,
    effect: "Earn campaign funds",
    imageSlug: "fundraise",
    imageAlt: "Political fundraising dinner",
    category: "money",
    requiresDonorBase: true,
  },
  {
    type: "buildDonorBase",
    label: "Build Donor Network",
    tagline: "Invest in the long game",
    flavor:
      "Subscription drives, major-donor cultivation, a finance operation that outlasts you. Costly now — but every future fundraise yields more.",
    actionCost: 6,
    fundCost: () => null,
    fundLabel: () => "Loading…",
    effect: "+1 Donor Network Level",
    imageSlug: "buildDonorBase",
    imageAlt: "Senior political figures at a formal gathering",
    category: "money",
  },
  {
    type: "convertCash",
    label: "Personal Campaign Donation",
    tagline: "Write yourself a cheque",
    flavor:
      "Funnel your personal fortune into the campaign war chest. The ethics board won't love it, and the press will have questions — but money talks louder than headlines.",
    actionCost: 2,
    fundCost: () => null,
    fundLabel: (c) => {
      // Post-Phase-8 (cashOnHand removed): read the home-currency personal
      // balance from currencyBalances. Fall back to the legacy field for
      // any test fixture that hasn't been migrated.
      const code = getHomeCurrency(c);
      const cash = c.currencyBalances?.personal?.[code] ?? c.cashOnHand ?? 0;
      return cash > 0 ? `${formatFundsCompact(cash)} available` : "No cash";
    },
    effect: "Half your cash becomes campaign funds",
    effectNote: "The other half is lost to the transfer. Larger donations add more Infamy.",
    imageSlug: "convertCash",
    imageAlt: "Banknotes and cheques",
    category: "money",
  },
  {
    type: "poll",
    label: "Commission Poll",
    tagline: "Topline intelligence",
    flavor:
      "A quick read of the electorate — overall appeal and the five groups you're strongest and weakest with. Adjust before it costs you.",
    actionCost: 2,
    fundCost: () => 25_000,
    fundLabel: () => formatFundsCompact(25_000),
    effect: "Topline + best/worst groups",
    imageSlug: "poll",
    imageAlt: "Survey data being tabulated",
    category: "research",
    href: "/actions/poll",
  },
  {
    type: "pollLarge",
    label: "Full Demographic Poll",
    tagline: "The complete picture",
    flavor:
      "A comprehensive breakdown across every demographic category in your state. Know who you're winning and losing — and exactly why.",
    actionCost: 6,
    fundCost: () => 75_000,
    fundLabel: () => formatFundsCompact(75_000),
    effect: "Full demographic breakdown",
    imageSlug: "pollLarge",
    imageAlt: "Large-scale tabulation machinery",
    category: "research",
    href: "/actions/poll",
  },
  {
    type: "canvass",
    label: "Canvass Voters",
    tagline: "Mobilize the base",
    flavor:
      "Door-knocking, telephone banks, community meetings. Target specific demographics in your home state — boost turnout where it counts most.",
    actionCost: 1,
    fundCost: () => 100,
    fundLabel: () => "$100",
    effect: "Boost demographic turnout · 2x effective during campaign season",
    imageSlug: "canvass",
    imageAlt: "Voters being canvassed on the doorstep",
    category: "influence",
    href: "/actions/canvass",
  },
  {
    type: "flipflop",
    label: "Flip-Flop",
    tagline: "Reverse course",
    flavor:
      "The electorate never remembers last Tuesday. Quietly recalibrate — shift your economic or social position one step in either direction.",
    actionCost: 15,
    fundCost: () => null,
    fundLabel: () => "Free",
    effect: "Shift position · +5 Infamy · −5% Influence",
    imageSlug: "flipflop",
    imageAlt: "A newspaper front page that called the result wrong",
    category: "influence",
  },
  {
    type: "debatePrep",
    label: "Debate Prep",
    tagline: "Study the briefing books",
    flavor:
      "Briefing binders, mock questions, and rehearsal. No war chest required — just focus. A sharp performance on stage starts here, one quiet evening at a time.",
    actionCost: 1,
    fundCost: () => null,
    fundLabel: () => "Free",
    effect: "10% chance: +1 Debate",
    imageSlug: "debatePrep",
    imageAlt: "A private study set out for briefing work",
    category: "research",
  },
];

export const CATEGORY_LABELS: Record<string, string> = {
  influence: "Influence",
  money: "Fundraising",
  research: "Intelligence",
};

/**
 * One shared photo scrim for every card.
 *
 * Replaces the old per-card `gradientOverlay`, which tinted each photograph a
 * different colour at 80–90% opacity — enough to bury the artwork. Neutral
 * black, bottom-weighted: the period photo reads at the top of the card and the
 * title stays legible over the dark foot. Category colour is spent on the chip,
 * rule and hover border instead, where a little of it goes further.
 */
export const CARD_PHOTO_SCRIM = "from-black/95 via-black/40 to-black/5";

/**
 * Per-category accent, in semantic tokens so all themes resolve it.
 *
 * `row` is the compact view's photo-less background: the category colour bleeds
 * in from the left over a near-black base, which keeps the white row text at
 * the contrast the previous per-card gradients gave it.
 */
export const CATEGORY_ACCENTS: Record<
  string,
  { chip: string; border: string; bar: string; row: string }
> = {
  influence: {
    chip: "border-primary/50 bg-primary/30 text-white",
    border: "hover:border-primary/50",
    bar: "bg-primary",
    row: "from-primary/40 via-black/80 to-black/85",
  },
  money: {
    chip: "border-success/50 bg-success/30 text-white",
    border: "hover:border-success/50",
    bar: "bg-success",
    row: "from-success/40 via-black/80 to-black/85",
  },
  research: {
    chip: "border-info/50 bg-info/30 text-white",
    border: "hover:border-info/50",
    bar: "bg-info",
    row: "from-info/40 via-black/80 to-black/85",
  },
};
