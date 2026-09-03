import { getDb } from "@/lib/mongodb";
import { formatFundsCompact } from "@/lib/utils/formatters";

export type WireEventType =
  | "sector_attack"
  | "sector_captured"
  | "corporation_founded"
  | "corporation_dissolved"
  | "corporation_restructured"
  | "corporation_relocated"
  | "dividend_changed"
  | "bond_issued"
  | "corp_credit_rating"
  | "corporation_renamed"
  | "corporation_ipo"
  | "corporation_nationalized"
  | "corporation_privatized"
  | "corporation_privatization_vote_opened"
  | "corporation_privatization_vote_failed"
  | "corporation_privatization_vote_cancelled"
  | "crisis_start"
  | "crisis_end"
  | "crisis_outcome"
  | "crisis_aid_pledged"
  | "crisis_aid_passed"
  | "crisis_aid_failed"
  // Per-race campaign wire. Unlike the economy events above, these carry an
  // `electionId` (and usually a `campaignId`) so the ticker on a race page can
  // ask for just that race's traffic. Headlines come from
  // `campaignWireHeadlines.ts`.
  //
  // Only genuinely event-shaped moments live here. State calls are deliberately
  // absent: `liveResults/computeResults.ts` defines "called" as a display
  // projection with the turn engine as the sole authority on outcomes, so the
  // general-election ticker derives its call headlines from that projection at
  // render time instead of persisting them as events.
  | "campaign_ops_level"
  | "campaign_rally"
  | "primary_tier_locked";

export interface WireEvent {
  type: WireEventType;
  headline: string;
  timestamp: Date;
  href?: string;
  /** Race this event belongs to. Absent on the economy-wide economy events. */
  electionId?: string;
  /** Campaign this event belongs to, when it is attributable to one. */
  campaignId?: string;
}

interface LogWireEventOptions {
  href?: string;
  electionId?: string;
  campaignId?: string;
}

let ttlIndexEnsured = false;

/** Pick a random element from an array */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Flavor text templates ────────────────────────────────────────────────────
// Each template receives named params and returns a headline string.

const SECTOR_ATTACK_TEMPLATES = [
  (a: string, v: string, sec: string, d: string, st: string) =>
    `RAID: ${a} seizes ${v} ${sec} revenue from ${d} in ${st}`,
  (a: string, v: string, sec: string, d: string, st: string) =>
    `HOSTILE: ${a} captures ${v} of ${d}'s ${sec} operations in ${st}`,
  (a: string, v: string, sec: string, d: string, st: string) =>
    `TAKEOVER: ${a} strips ${v} ${sec} from ${d} in ${st}`,
  (a: string, v: string, sec: string, d: string, st: string) =>
    `ATTACK: ${a} raids ${d}'s ${sec} holdings in ${st}, seizing ${v}`,
  (a: string, v: string, sec: string, d: string, st: string) =>
    `WARFARE: ${a} overwhelms ${d} in ${st}, claiming ${v} ${sec}`,
  (a: string, v: string, sec: string, d: string, st: string) =>
    `BLITZ: ${a} storms ${d}'s ${sec} sector in ${st} — ${v} captured`,
  (a: string, v: string, sec: string, d: string, st: string) =>
    `CORP WAR: ${d} loses ${v} ${sec} revenue to ${a} in ${st}`,
  (a: string, v: string, sec: string, d: string, st: string) =>
    `AGGRESSION: ${a} moves on ${d}'s ${st} ${sec} turf, taking ${v}`,
];

const SECTOR_CAPTURED_TEMPLATES = [
  (a: string, v: string, sec: string, st: string) =>
    `EXPAND: ${a} captures ${v} unowned ${sec} market in ${st}`,
  (a: string, v: string, sec: string, st: string) =>
    `GROWTH: ${a} claims ${v} of untapped ${sec} sector in ${st}`,
  (a: string, v: string, sec: string, st: string) =>
    `SPLIT: ${a} enters ${st} ${sec} market with ${v} stake`,
  (a: string, v: string, sec: string, st: string) =>
    `VENTURE: ${a} breaks into ${st}'s ${sec} industry — ${v} secured`,
  (a: string, v: string, sec: string, st: string) =>
    `FRONTIER: ${a} stakes ${v} claim in ${st}'s open ${sec} market`,
  (a: string, v: string, sec: string, st: string) =>
    `LAND GRAB: ${a} acquires ${v} of unclaimed ${sec} in ${st}`,
  (a: string, v: string, sec: string, st: string) =>
    `NEW MARKET: ${a} carves out ${v} ${sec} foothold in ${st}`,
  (a: string, v: string, sec: string, st: string) =>
    `EXPANSION: ${a} pushes into ${st}, securing ${v} in ${sec}`,
];

const CORP_FOUNDED_TEMPLATES = [
  (name: string, type: string, state: string) => `NEW: ${name} (${type}) incorporated in ${state}`,
  (name: string, type: string, state: string) =>
    `IPO: ${name} launches as ${type} venture in ${state}`,
  (name: string, type: string, state: string) =>
    `FOUNDED: ${name} opens for business in ${state} (${type})`,
  (name: string, type: string, state: string) =>
    `STARTUP: ${name} enters the ${type} sector from ${state}`,
  (name: string, type: string, state: string) =>
    `LAUNCH: ${name} debuts as a ${type} firm based in ${state}`,
  (name: string, type: string, state: string) =>
    `INCORPORATED: ${name} files papers in ${state} — new ${type} player`,
  (name: string, type: string, state: string) =>
    `BREAKING: New ${type} corporation ${name} chartered in ${state}`,
  (name: string, type: string, state: string) =>
    `VENTURE: ${name} raised capital, opens ${type} shop in ${state}`,
];

const CORP_DISSOLVED_TEMPLATES = [
  (name: string, cap: string) =>
    `DISSOLVED: ${name} ceases operations — ${cap} returned to investors`,
  (name: string, cap: string) => `CLOSED: ${name} shutters its doors, liquidating ${cap}`,
  (name: string, cap: string) => `BANKRUPT: ${name} dissolved — ${cap} salvaged from wreckage`,
  (name: string, cap: string) =>
    `LIQUIDATED: ${name} winds down, distributing ${cap} to shareholders`,
  (name: string, cap: string) => `GONE: ${name} folds — ${cap} returned from the ashes`,
  (name: string, cap: string) => `DEFUNCT: ${name} closes permanently, ${cap} recouped`,
  (name: string, cap: string) => `SHUTDOWN: ${name} calls it quits, ${cap} liquidated`,
  (name: string, cap: string) => `END OF AN ERA: ${name} dissolved — ${cap} paid out to investors`,
];

const DIVIDEND_TEMPLATES = [
  (name: string, rate: string) => `DIV: ${name} sets dividend to ${rate}%`,
  (name: string, rate: string) => `YIELD: ${name} adjusts payout to ${rate}%`,
  (name: string, rate: string) => `DIVIDEND: ${name} declares ${rate}% distribution`,
  (name: string, rate: string) => `PAYOUT: ${name} moves dividend rate to ${rate}%`,
  (name: string, rate: string) => `SHAREHOLDER ALERT: ${name} now paying ${rate}% dividends`,
  (name: string, rate: string) => `INCOME: ${name} announces ${rate}% yield for shareholders`,
  (name: string, rate: string) => `DISTRIBUTION: ${name} revises payout — now ${rate}%`,
  (name: string, rate: string) => `RETURNS: ${name} sets shareholder dividend at ${rate}%`,
];

const BOND_TEMPLATES = [
  (name: string, amt: string, mat: string, rate: string) =>
    `BOND: ${name} issues ${amt} in ${mat} bonds at ${rate}%`,
  (name: string, amt: string, mat: string, rate: string) =>
    `DEBT: ${name} raises ${amt} via ${mat} bond offering at ${rate}%`,
  (name: string, amt: string, mat: string, rate: string) =>
    `ISSUANCE: ${name} floats ${amt} in ${mat} notes, coupon ${rate}%`,
  (name: string, amt: string, mat: string, rate: string) =>
    `OFFERING: ${name} sells ${amt} in ${mat} bonds, yielding ${rate}%`,
  (name: string, amt: string, mat: string, rate: string) =>
    `CAPITAL: ${name} taps bond market — ${amt} at ${rate}% for ${mat}`,
  (name: string, amt: string, mat: string, rate: string) =>
    `FIXED INCOME: ${name} prices ${amt} ${mat} bond deal at ${rate}%`,
  (name: string, amt: string, mat: string, rate: string) =>
    `NEW DEBT: ${name} borrows ${amt} with ${mat} maturity at ${rate}%`,
  (name: string, amt: string, mat: string, rate: string) =>
    `FINANCING: ${name} secures ${amt} via ${mat} bonds — ${rate}% coupon`,
];

// ── Public helpers ───────────────────────────────────────────────────────────

export function wireHeadlineSectorAttack(
  attacker: string,
  valueDollars: number,
  sectorLabel: string,
  defender: string,
  state: string
): string {
  const v = formatFundsCompact(Math.round(valueDollars));
  return pick(SECTOR_ATTACK_TEMPLATES)(attacker, v, sectorLabel, defender, state);
}

export function wireHeadlineSectorCaptured(
  corp: string,
  valueDollars: number,
  sectorType: string,
  state: string
): string {
  const v = formatFundsCompact(Math.round(valueDollars));
  return pick(SECTOR_CAPTURED_TEMPLATES)(corp, v, sectorType, state);
}

export function wireHeadlineCorpFounded(name: string, typeLabel: string, state: string): string {
  return pick(CORP_FOUNDED_TEMPLATES)(name, typeLabel, state);
}

export function wireHeadlineCorpDissolved(name: string, capitalDollars: number): string {
  const cap = formatFundsCompact(Math.round(capitalDollars));
  return pick(CORP_DISSOLVED_TEMPLATES)(name, cap);
}

const CORP_RESTRUCTURED_TEMPLATES = [
  (name: string, debt: string, sectors: string) =>
    `RESTRUCTURING: ${name} sells ${sectors} to clear ${debt} of defaulted debt`,
  (name: string, debt: string, sectors: string) =>
    `DEBT CURED: ${name} liquidates ${sectors} to repay ${debt} bondholders in full`,
  (name: string, debt: string, sectors: string) =>
    `WORKOUT: ${name} offloads ${sectors}, settling ${debt} in defaulted bonds`,
];

export function wireHeadlineCorpRestructured(
  name: string,
  debtClearedDollars: number,
  sectorsLiquidated: number
): string {
  const debt = formatFundsCompact(Math.round(debtClearedDollars));
  const sectors = `${sectorsLiquidated} sector${sectorsLiquidated === 1 ? "" : "s"}`;
  return pick(CORP_RESTRUCTURED_TEMPLATES)(name, debt, sectors);
}

export function wireHeadlineDividend(name: string, rate: string): string {
  return pick(DIVIDEND_TEMPLATES)(name, rate);
}

export function wireHeadlineBond(
  name: string,
  faceValueDollars: number,
  maturityLabel: string,
  couponRate: string
): string {
  const amt = formatFundsCompact(Math.round(faceValueDollars));
  return pick(BOND_TEMPLATES)(name, amt, maturityLabel, couponRate);
}

const CORP_CREDIT_TEMPLATES = [
  (name: string, from: string, to: string) => `CREDIT: ${name} rating moves ${from} → ${to}`,
  (name: string, from: string, to: string) => `DEBT WATCH: ${name} now rated ${to} (was ${from})`,
  (name: string, from: string, to: string) =>
    `AGENCIES: ${name} corporate credit revised from ${from} to ${to}`,
  (name: string, from: string, to: string) =>
    `RATING ACTION: ${name} revised from ${from} to ${to}`,
];

export function wireHeadlineCorpCreditRating(
  name: string,
  fromRating: string,
  toRating: string
): string {
  return pick(CORP_CREDIT_TEMPLATES)(name, fromRating, toRating);
}

const CORP_IPO_TEMPLATES = [
  (name: string, floatPct: number) => `IPO: ${name} goes public — ${floatPct}% float`,
  (name: string, floatPct: number) => `${name} lists ${floatPct}% to the public market`,
  (name: string, floatPct: number) => `${name} raises capital via ${floatPct}% IPO`,
  (name: string, floatPct: number) => `${name} debuts on the market with ${floatPct}% public float`,
];

export function wireHeadlineCorpIpo(name: string, floatPct: number): string {
  return pick(CORP_IPO_TEMPLATES)(name, floatPct);
}

const CORP_PRIVATIZED_TEMPLATES = [
  (name: string) => `${name} taken private after successful buyout vote`,
  (name: string) => `BUYOUT: ${name} returns to private ownership`,
  (name: string) => `${name} delisted as CEO consolidates ownership`,
];

export function wireHeadlineCorpPrivatized(name: string): string {
  return pick(CORP_PRIVATIZED_TEMPLATES)(name);
}

const CORP_PRIVATIZATION_VOTE_OPENED_TEMPLATES = [
  (name: string, price: number) => `${name} CEO calls buyout vote at $${price.toFixed(2)}/share`,
  (name: string, price: number) =>
    `Privatization vote opened at ${name} ($${price.toFixed(2)}/share)`,
];

export function wireHeadlineCorpPrivatizationVoteOpened(name: string, price: number): string {
  return pick(CORP_PRIVATIZATION_VOTE_OPENED_TEMPLATES)(name, price);
}

const CORP_PRIVATIZATION_VOTE_FAILED_TEMPLATES = [
  (name: string) => `${name} privatization vote rejected by shareholders`,
  (name: string) => `BUYOUT FAILS: ${name} stays public`,
];

export function wireHeadlineCorpPrivatizationVoteFailed(name: string): string {
  return pick(CORP_PRIVATIZATION_VOTE_FAILED_TEMPLATES)(name);
}

const CORP_PRIVATIZATION_VOTE_CANCELLED_TEMPLATES = [
  (name: string) => `${name} CEO withdraws privatization vote`,
];

export function wireHeadlineCorpPrivatizationVoteCancelled(name: string): string {
  return pick(CORP_PRIVATIZATION_VOTE_CANCELLED_TEMPLATES)(name);
}

/**
 * Log a wire service event. Fire-and-forget — never throws.
 * Events auto-expire after 48 hours via TTL index.
 */
export async function logWireEvent(
  type: WireEventType,
  headline: string,
  options?: LogWireEventOptions
): Promise<void> {
  try {
    const db = await getDb();
    const col = db.collection<WireEvent>("wireEvents");

    // Ensure indexes once per process lifetime
    if (!ttlIndexEnsured) {
      ttlIndexEnsured = true;
      col.createIndex({ timestamp: 1 }, { expireAfterSeconds: 48 * 60 * 60 }).catch(() => {});
      // Backs the per-race feed's "this election, newest first" query.
      col
        .createIndex(
          { electionId: 1, timestamp: -1 },
          { sparse: true, name: "wire_election_recent" }
        )
        .catch(() => {});
    }

    await col.insertOne({
      type,
      headline,
      timestamp: new Date(),
      ...(options?.href ? { href: options.href } : {}),
      ...(options?.electionId ? { electionId: options.electionId } : {}),
      ...(options?.campaignId ? { campaignId: options.campaignId } : {}),
    });
  } catch {
    // Fire-and-forget
  }
}
