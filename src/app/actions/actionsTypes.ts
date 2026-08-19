import type { Character, State } from "@/lib/db/types";
import type { ActionImageSlug } from "@/lib/images/actionImages";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface ActionCard {
  type: string;
  label: string;
  tagline: string;
  flavor: string;
  actionCost: number;
  fundCost: (char: Character) => number | null;
  fundLabel: (char: Character) => string;
  effect: string;
  /**
   * One plain sentence explaining what makes the effect vary, for effects whose
   * headline number is a range or carries a side cost. Rendered under the
   * effect on the full card.
   */
  effectNote?: string;
  /**
   * Art key, not a URL — the concrete image is resolved per era and country by
   * `getActionImage`, so the same card shows 1953 US campaign art to an American
   * player and 1953 East German art to a DD player.
   */
  imageSlug: ActionImageSlug;
  /** Describes the subject, not one specific photo — the photo varies by era. */
  imageAlt: string;
  category: "influence" | "money" | "research";
  href?: string;
  requiresDonorBase?: boolean;
}

export type ActionsViewMode = "cards" | "compact";

export interface ActionCardProps {
  card: ActionCard;
  /** CDN URL already resolved for the live era + the player's country. */
  imageUrl: string;
  index: number;
  viewMode: ActionsViewMode;
  character: Character;
  homeState: State | null;
  executing: string | null;
  flash: { type: string; msg: string; ok: boolean } | null;
  flipflopStep: "axis" | "direction" | null;
  flipflopAxis: "economic" | "social" | null;
  flipflopDir: -1 | 1 | null;
  onExecute: (type: string, count?: 1 | 5 | 10) => void;
  onFlipflop: (axis: "economic" | "social", direction: -1 | 1) => void;
  onFlipflopStepChange: (step: "axis" | "direction" | null) => void;
  onFlipflopAxisChange: (axis: "economic" | "social" | null) => void;
  onFlipflopDirChange: (dir: -1 | 1 | null) => void;
  campaignActionCost: number;
  campaignFundCost: number;
  campaignMaxed: boolean;
  advertiseActionCost: number;
  advertiseFundCost: number;
  fundraiseActionCost: number;
  buildDonorBaseActionCost: number;
  buildDonorBaseFundCost: number;
  /**
   * Per-use fundraise yield, already in the campaign treasury's LOCAL currency
   * face value (see `fundraiseYieldLocal`). Render it with
   * `formatCurrencyFaceAmount`, never with the live-forex `formatAmount`.
   */
  fundraiseYield: number;
  /** Currency code the campaign treasury (and therefore `fundraiseYield`) is denominated in. */
  campaignCurrency: CurrencyCode;
  /** Campaign balance for affordability (matches execute when forex is on). */
  displayCampaignFunds: number;
  /** Personal spendable balance for convert-cash UI (matches execute when forex is on). */
  displayPersonalWealth: number;
  /** Home state document failed to load — GDP-scaled costs cannot be shown; block those actions. */
  blockGdpScaledCosts: boolean;
  /** Pass through to batch simulation so previews match server fund checks. */
  forexEnabled: boolean;
  convertCashOpen: boolean;
  convertCashAmount: string;
  onConvertCashOpenChange: (open: boolean) => void;
  onConvertCashAmountChange: (amount: string) => void;
  onConvertCashExecute: (amount: number) => void;
}
