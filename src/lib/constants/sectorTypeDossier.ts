/**
 * What each kind of sector actually is. Every sector type a corporation can own
 * has a briefing naming the business and what moves its margin
 * (SECTOR_TYPE_BRIEFING), a colour it is drawn in everywhere
 * (SECTOR_TYPE_PALETTE), and two proposed controls that are not built yet
 * (SECTOR_TYPE_PROPOSED_ACTIONS). The Sectors tab reads all three.
 */
/**
 * Sector-type dossier copy and palette.
 *
 * The Sectors tab used to be one flat table of every site a corporation owns,
 * with the sector type reduced to a coloured word on each row. A corp running
 * mines, newsrooms and power stations read as one undifferentiated list, and
 * nothing on the page said what any of those businesses actually DO.
 *
 * This file holds the static half of the fix: the per-type briefing, the hero
 * photograph and the colour the type is drawn in. Nothing here is persisted,
 * read by the turn, or allowed to change a number, exactly like
 * facilityVocabulary. The live half (counts, revenue, utilisation) is computed
 * in `sectorTypeMetrics` from the sectors themselves.
 *
 * COPY RULE (project standing): plain language, short, no dashes.
 */

import type { CorporationType } from "./corporations";

/**
 * Type colour as raw hex.
 *
 * `CorporationHelpers.getTypeColor` already names the Tailwind palette for each
 * type, but it returns utility CLASSES, and the dossier needs the same colours
 * at arbitrary alpha in tints, gradients, chain bars and tab underlines.
 * Tailwind 4 cannot build `bg-${type}-500/15` from a runtime string, so the
 * values are written out here at the 400 (text) and 500 (surface) stops that
 * getTypeColor uses. Changing a colour means changing it in both places.
 */
export interface SectorTypePalette {
  /** 400 stop: text, headings, chips. */
  c400: string;
  /** 500 stop: borders, tints, bars. Always used with alpha. */
  c500: string;
}

export const SECTOR_TYPE_PALETTE: Record<CorporationType, SectorTypePalette> = {
  financial: { c400: "#34d399", c500: "#10b981" }, // emerald
  media: { c400: "#60a5fa", c500: "#3b82f6" }, // blue
  manufacturing: { c400: "#fb923c", c500: "#f97316" }, // orange
  chemical_industries: { c400: "#4ade80", c500: "#22c55e" }, // green
  healthcare: { c400: "#fb7185", c500: "#f43f5e" }, // rose
  retail: { c400: "#a78bfa", c500: "#8b5cf6" }, // violet
  automobiles: { c400: "#38bdf8", c500: "#0ea5e9" }, // sky
  technology: { c400: "#22d3ee", c500: "#06b6d4" }, // cyan
  energy: { c400: "#facc15", c500: "#eab308" }, // yellow
  agriculture: { c400: "#a3e635", c500: "#84cc16" }, // lime
  real_estate: { c400: "#fbbf24", c500: "#f59e0b" }, // amber
  construction: { c400: "#fb923c", c500: "#f97316" }, // orange
  defense: { c400: "#94a3b8", c500: "#64748b" }, // slate
  telecommunications: { c400: "#818cf8", c500: "#6366f1" }, // indigo
  entertainment: { c400: "#f472b6", c500: "#ec4899" }, // pink
  logistics: { c400: "#a8a29e", c500: "#78716c" }, // stone
  extraction: { c400: "#a3a3a3", c500: "#737373" }, // neutral
};

const NEUTRAL_PALETTE: SectorTypePalette = { c400: "#8f8f9d", c500: "#64748b" };

/** Palette for a type. Unknown types fall back to neutral rather than throwing. */
export function sectorTypePalette(type: CorporationType | string | null | undefined) {
  if (!type) return NEUTRAL_PALETTE;
  return SECTOR_TYPE_PALETTE[type as CorporationType] ?? NEUTRAL_PALETTE;
}

/** `#rrggbb` at alpha, for inline tints. */
export function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Period photograph for the type's dossier banner.
 *
 * Six types ship no photo (chemical industries, automobiles, real estate,
 * construction, telecommunications, entertainment). Their banners render the
 * type tint and gradient with no image layer, which reads as deliberate rather
 * than broken, and the dossier needs no other special case.
 */
export const SECTOR_TYPE_HERO: Partial<Record<CorporationType, string>> = {
  manufacturing: "/static/heroes/sector-manufacturing.webp",
  energy: "/static/heroes/sector-energy.webp",
  extraction: "/static/heroes/sector-extraction.webp",
  retail: "/static/heroes/sector-retail.webp",
  financial: "/static/heroes/sector-financial.webp",
  media: "/static/heroes/sector-media.webp",
  technology: "/static/heroes/sector-technology.webp",
  agriculture: "/static/heroes/sector-agriculture.webp",
  healthcare: "/static/heroes/sector-healthcare.webp",
  defense: "/static/heroes/sector-defense.webp",
  logistics: "/static/heroes/sector-logistics.webp",
};

/**
 * What this business actually is, in two sentences.
 *
 * The point of the briefing is that a player who has never run a power station
 * should be able to read one and know what moves its margin. Every line names
 * the exposure, because that is the decision the sector asks of its owner.
 */
export const SECTOR_TYPE_BRIEFING: Record<CorporationType, string> = {
  manufacturing:
    "Turns iron and coal into steel and building materials. Margins live and die on input prices, so a manufacturing corp fights for supply agreements as hard as for market share.",
  energy:
    "Sells power to every other sector in the state. Demand is nearly guaranteed, but the fuel mix decides exposure: coal and gas prices, or electronics for renewables.",
  extraction:
    "Pulls raw commodities out of a finite state deposit. Output depends on what is actually in the ground; deposits deplete, royalties are negotiated with the state.",
  retail:
    "Sells finished goods to households. The most demand sensitive type: consumer confidence, brand loyalty and advertising move revenue more than any input price.",
  financial:
    "Lends, underwrites and trades. Earns on the spread between deposits and the central bank rate, so rate decisions and credit conditions matter more than commodities.",
  media:
    "Sells advertising against an audience. Uniquely, a media sector also shapes opinion: editorial stance nudges approval for parties and politicians in the state.",
  technology:
    "Produces electronics and software and generates the corporation's R&D points. Talent constrained rather than material constrained; the tech tree is unlocked here.",
  agriculture:
    "Grows food on a seasonal cycle. Output swings with the harvest calendar and weather events; fertilizer and fuel are the exposure, subsidies the cushion.",
  healthcare:
    "Delivers care to the state population. Revenue tracks public health spending and insurance policy; a well run network lifts state health metrics, which voters notice.",
  defense:
    "Sells to governments, not markets. Revenue is contract backlog: procurement orders, delivery grades and export licences decide the year, not consumer demand.",
  logistics:
    "Moves everyone else's goods. Every depot adds freight capacity and network coverage, which directly offsets the corporation's own sprawl penalty.",
  chemical_industries:
    "Refines oil and energy into feedstocks everyone downstream needs: chemicals, plastics, fertilizers, drugs. Flexible output mix, but every line carries spill and regulatory risk.",
  automobiles:
    "Assembles vehicles from steel, electronics and plastics. A brand business as much as a factory one: model cycles, recalls and fuel prices move demand more than capacity.",
  real_estate:
    "Owns and leases property. Revenue is slow and sticky; the exposure is the central bank rate and the local construction market, and every development anchors a state's housing metric.",
  construction:
    "Builds for everyone else. Demand follows the state's development pipeline and public works budget; the exposure is steel and building-material prices and idle crews between contracts.",
  telecommunications:
    "Runs the network every digital sector rides on. Coverage is territorial: hubs compete for spectrum and right-of-way in each state, and outages hit approval fast.",
  entertainment:
    "Sells experiences: studios, venues and digital content. Revenue swings with release slates and consumer confidence, and a hit lifts the corp's brand across every other sector.",
};

/**
 * Type-specific levers the design proposes and the game does not have.
 *
 * These render as DISABLED buttons on the dossier and the strategy panel. They
 * are here rather than dropped because the shape of the page is part of what
 * was designed: a player should be able to see that a mine and a newsroom are
 * eventually steered by different controls, and the tooltip says plainly that
 * the control does not exist yet.
 *
 * Nothing reads this list to build behaviour. When one of these ships for real
 * it moves out of here and becomes a live action.
 */
export interface ProposedSectorAction {
  label: string;
  /** What it would do. Shown as the disabled button's tooltip. */
  help: string;
}

export const SECTOR_TYPE_PROPOSED_ACTIONS: Partial<
  Record<CorporationType, readonly ProposedSectorAction[]>
> = {
  manufacturing: [
    {
      label: "Retool line",
      help: "Change the output mix of this plant's steel / building-materials split without a full strategy switch. Costs 10% of daily revenue; takes effect next turn.",
    },
    {
      label: "Lock supply agreement",
      help: "Sign a 24-turn fixed-price contract for iron or coal with a mining corporation. Shields margin from spot-price spikes at a small premium.",
    },
  ],
  energy: [
    {
      label: "Set fuel mix",
      help: "Shift generation between coal, gas and renewables within the current strategy. Moves fuel exposure and the state's emissions metric.",
    },
    {
      label: "Bid grid contract",
      help: "Bid to become the state's contracted supplier. Winning guarantees demand for 48 turns at a negotiated rate.",
    },
  ],
  extraction: [
    {
      label: "Survey deposit",
      help: "Spend one turn of output to reveal the exact remaining reserve and ore grade for this mine.",
    },
    {
      label: "Negotiate royalty",
      help: "Open a royalty negotiation with the state government. Outcome depends on governor approval and your political capital.",
    },
  ],
  retail: [
    {
      label: "Run promotion",
      help: "Spend advertising to lift foot traffic for 12 turns at the cost of basket value.",
    },
    {
      label: "Reprice range",
      help: "Set a pricing posture (discount / standard / premium) for these stores, trading volume against margin.",
    },
  ],
  financial: [
    {
      label: "Adjust lending rate",
      help: "Set this branch network's lending spread over the central bank rate. Wider spread earns more but shrinks the loan book.",
    },
    {
      label: "Apply for charter",
      help: "Apply for a state banking charter, unlocking deposit-taking and the Bank console for this corporation.",
    },
  ],
  media: [
    {
      label: "Set editorial stance",
      help: "Choose an editorial lean. Shifts approval for aligned politicians in the state and changes which advertisers buy inventory.",
    },
    {
      label: "Sell ad inventory",
      help: "Offer this newsroom's advertising to a campaign or party for a fixed number of turns.",
    },
  ],
  technology: [
    {
      label: "Assign R&D",
      help: "Direct this campus's R&D points to a specific tech-tree branch instead of the corporation-wide pool.",
    },
    {
      label: "Poach talent",
      help: "Recruit engineers from a rival campus in the same state. Raises R&D output, costs marketing strength.",
    },
  ],
  agriculture: [
    {
      label: "Plant season crop",
      help: "Pick the crop for the coming season. Locks the yield profile and fertilizer demand until harvest.",
    },
    {
      label: "Buy futures",
      help: "Hedge next season's food price with a commodity futures position from the treasury.",
    },
  ],
  healthcare: [
    {
      label: "Bid public contract",
      help: "Bid for a share of the state health budget. Winning adds guaranteed revenue and lifts state health metrics.",
    },
    {
      label: "Expand ward",
      help: "Add bed capacity to these clinics at reduced build cost while occupancy is above 85%.",
    },
  ],
  defense: [
    {
      label: "Bid procurement",
      help: "Submit a bid on an open government procurement order for this arsenal's product line.",
    },
    {
      label: "Apply export licence",
      help: "Apply to the foreign ministry to sell ordnance abroad. Requires a friendly government and raises nationalisation risk.",
    },
  ],
  logistics: [
    {
      label: "Extend route",
      help: "Add a freight lane to a neighbouring state, extending network coverage and relieving delivery-limited sectors there.",
    },
    {
      label: "Sign freight lane",
      help: "Offer a fixed-rate freight contract to another corporation's sector in this state.",
    },
  ],
  chemical_industries: [
    {
      label: "Reconfigure line",
      help: "Shift this works between chemicals, plastics and fertilizer output within its strategy. Takes 6 turns; no cooldown.",
    },
    {
      label: "File compliance report",
      help: "Submit an environmental compliance filing to the state. Improves the compliance rating and lowers spill-event risk for 48 turns.",
    },
  ],
  automobiles: [
    {
      label: "Launch model refresh",
      help: "Start a new model cycle. Costs marketing strength now, lifts vehicle demand for 36 turns after launch.",
    },
    {
      label: "Issue recall",
      help: "Voluntarily recall a batch. Immediate revenue hit, but avoids a larger approval and brand penalty if the state regulator finds it first.",
    },
  ],
  real_estate: [
    {
      label: "Refinance portfolio",
      help: "Roll floating-rate property debt into fixed at the current policy rate. Locks financing cost for 96 turns.",
    },
    {
      label: "Rezone parcel",
      help: "Petition the state to rezone a development site (residential to commercial, or back). Outcome depends on governor approval.",
    },
  ],
  construction: [
    {
      label: "Bid public works",
      help: "Bid on a state infrastructure tender. Winning books contract pipeline and lifts the state's infrastructure metric.",
    },
    {
      label: "Hire crews",
      help: "Add crews to raise utilisation ahead of a booked contract. Payroll starts immediately.",
    },
  ],
  telecommunications: [
    {
      label: "Bid spectrum auction",
      help: "Bid for licensed spectrum in this state. More bands raise coverage and block rival hubs.",
    },
    {
      label: "Upgrade backbone",
      help: "Invest in backbone capacity for this hub, raising uptime and unlocking cloud / 5G strategies sooner.",
    },
  ],
  entertainment: [
    {
      label: "Greenlight production",
      help: "Commit a title or show to the release slate. Costs upfront, pays out over the following 24 turns.",
    },
    {
      label: "Book headline act",
      help: "Book a headline event at these venues. Spikes attendance and advertising output for 6 turns.",
    },
  ],
};

/** The sentence appended to every proposed action's tooltip. Said once, here. */
export const PROPOSED_ACTION_NOTE =
  "Proposed control. It does not exist in the game yet, so the button is disabled.";

/** Proposed actions for a type, or an empty list. */
export function proposedSectorActions(
  type: CorporationType | string | null | undefined
): readonly ProposedSectorAction[] {
  if (!type) return [];
  return SECTOR_TYPE_PROPOSED_ACTIONS[type as CorporationType] ?? [];
}
