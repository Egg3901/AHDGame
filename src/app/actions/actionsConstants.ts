import { formatFundsCompact } from "@/lib/utils/formatters";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { getPollActionCost, getPollBaseFundCost } from "@/lib/actions";
import {
  CONVERT_CASH_ACTION_COST,
  DEBATE_PREP_ACTION_COST,
  describeDebatePrepEffect,
  FUNDRAISE_ACTION_COST,
  fundraiseYieldAnchor,
} from "@/lib/actions/rules";
import type { ActionCard } from "./actionsTypes";

export const CARDS: ActionCard[] = [
  {
    type: "campaign",
    label: "Campaign",
    tagline: "Raises Political Influence",
    flavor:
      "Each use adds less once you are above 50% influence. It costs 1 action below 20% influence and 5 at 80% or more, and its money cost rises with your influence and your home state's GDP per head.",
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
    tagline: "Raises Favorability",
    flavor:
      "It costs 5 actions below 30% favorability and 9 at 85% or more, and its money cost rises with your favorability and your home state's GDP per head.",
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
    tagline: "Raises money from your donors",
    flavor:
      "The amount grows with your donor level, Political Influence and Fundraising. It costs no money, but needs a donor level of at least 1.",
    // Single source of truth: the same rules quote the execute shell credits,
    // so the advertised yield (influence + fundraising-stat scaled) can never
    // drift from the credited result.
    actionCost: FUNDRAISE_ACTION_COST,
    fundCost: () => null,
    fundLabel: (c) => `+${formatFundsCompact(fundraiseYieldAnchor(c))}`,
    effect: "Earn campaign funds",
    imageSlug: "fundraise",
    imageAlt: "Political fundraising dinner",
    category: "money",
    requiresDonorBase: true,
  },
  {
    type: "buildDonorBase",
    label: "Build Donor Network",
    tagline: "Adds one donor level",
    flavor:
      "Each level raises what every later Fundraise pays. It costs 4 actions at first, rising to 20 as your level grows, plus campaign money that rises with your level.",
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
    tagline: "Puts your own cash into the campaign",
    flavor:
      "Half the money is lost in the transfer, and the donation adds Infamy that grows with its size. Infamy above 20 drains Favorability every turn.",
    // Canonical ConvertCash owner: the flat AP cost the shared rules quote
    // execution debits (quoteConvertCashAction). This card's actionCost
    // renders live (no page-level prop shadows it, unlike the
    // state-dependent campaign/advertise/buildDonorBase costs), so it reads
    // the const directly.
    actionCost: CONVERT_CASH_ACTION_COST,
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
    tagline: "Quick read of your support",
    flavor:
      "Shows your overall appeal in your state and the five voter groups you do best and worst with. A higher Intellect lowers the money cost.",
    // Canonical Poll owner: flat AP cost and unscaled ANCHOR base fund cost
    // from the shared rules quote execution debits (quotePollAction). The
    // card preview stays display-only: the intellect-scaled debit is quoted
    // by the poll route, not recomputed here.
    actionCost: getPollActionCost("small"),
    fundCost: () => getPollBaseFundCost("small"),
    fundLabel: () => formatFundsCompact(getPollBaseFundCost("small")),
    effect: "Topline + best/worst groups",
    imageSlug: "poll",
    imageAlt: "Survey data being tabulated",
    category: "research",
    href: "/actions/poll",
  },
  {
    type: "pollLarge",
    label: "Full Demographic Poll",
    tagline: "Full breakdown of your support",
    flavor:
      "Shows your appeal with every voter group in every demographic category in your state. A higher Intellect lowers the money cost.",
    // Same canonical owner as the quick poll, large tier.
    actionCost: getPollActionCost("large"),
    fundCost: () => getPollBaseFundCost("large"),
    fundLabel: () => formatFundsCompact(getPollBaseFundCost("large")),
    effect: "Full demographic breakdown",
    imageSlug: "pollLarge",
    imageAlt: "Large-scale tabulation machinery",
    category: "research",
    href: "/actions/poll",
  },
  {
    type: "targetedAds",
    label: "Targeted Ads",
    tagline: "Vote bonus with groups you choose",
    flavor:
      "Targets voter groups in your home state, and presidential candidates can target other states. The bonus is larger with groups that share your positions and halves every 24 turns.",
    actionCost: 1,
    fundCost: () => 100,
    fundLabel: () => "$100 per action",
    effect: "Aligned, cohesive groups respond more strongly",
    imageSlug: "advertise",
    imageAlt: "Street advertising and campaign hoardings",
    category: "influence",
    href: "/actions/targeted-ads",
  },
  {
    type: "canvass",
    label: "Canvass Voters",
    tagline: "Raises turnout in groups you choose",
    flavor:
      "You canvass in your home state, or where you are campaigning if you run for president. Groups that share your positions respond more, and the gain halves every 6 turns.",
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
    tagline: "Changes your policy position",
    flavor:
      "You pick the economic or social axis and move one step left or right. On top of the action cost, it adds 5 Infamy and cuts your influence by 5%.",
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
    tagline: "Chance to raise Debate",
    flavor:
      "A successful roll raises your Debate skill by 1. It costs no money, and the action is spent whether or not the roll succeeds.",
    // Single source of truth: the same rules quote the execute shell gates
    // on, so the advertised cost and odds can never drift from the resolved
    // roll (the label previously advertised 10% while the roll resolved 15%).
    actionCost: DEBATE_PREP_ACTION_COST,
    fundCost: () => null,
    fundLabel: () => "Free",
    effect: describeDebatePrepEffect(),
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
 * Neutral black, bottom-weighted: the period photo reads at the top of the card
 * and the title stays legible over the dark foot. Categories carry no color;
 * the category name sits in plain text beside the tagline and in the filter tabs.
 */
export const CARD_PHOTO_SCRIM = "from-black/95 via-black/40 to-black/5";
