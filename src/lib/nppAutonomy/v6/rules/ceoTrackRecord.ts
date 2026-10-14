/**
 * NPP engine 6: CEO choice by record (v6).
 *
 * Below v6 an NPP-run company takes its CEO from whichever party runs the
 * fewest companies, then that party's most influential free NPP. Nothing about
 * how the NPP did running a company before is kept or read. At v6 the picker
 * prefers a free NPP whose companies in the same sector beat their peers'
 * margins, and falls back to the party rule when nobody has such a record.
 * Smarter, not stronger: no money or stats change, only who is seated.
 *
 * The record is bookkeeping and is written at every autonomy level, so a
 * world switched to v6 already has history to read. Once a game day each NPP
 * CEO's companies are sampled: per operating lane, the company's operating
 * margin minus the mean margin of other companies' sectors in the same
 * country and lane. Margins are ratios, so the measure is currency-neutral.
 *
 * Pure. The turn shell supplies corporations and sectors already loaded for
 * the corporation turn and writes the result with one bulkWrite.
 */
import {
  operatingSectorTypeFor,
  type CorporationType,
  type OperatingSectorType,
} from "@/lib/constants/corporations";
import { TURNS_PER_DAY, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { NppCeoSectorRecord, NppCeoTrackRecord } from "@/lib/db/types/npp";

export type { NppCeoSectorRecord, NppCeoTrackRecord };

/** The record pass runs on turns divisible by this, and credits this many turns. */
export const CEO_RECORD_CADENCE_TURNS = TURNS_PER_DAY;
/** Stored tenure cap, so `turns` stays bounded. */
export const CEO_RECORD_MAX_TURNS = 20 * TURNS_PER_YEAR;
/** Older history counts at most this many turns against a new sample. */
export const CEO_RECORD_WEIGHT_CAP_TURNS = 4 * TURNS_PER_YEAR;
/** A record shorter than this is not a record yet. */
export const CEO_RECORD_MIN_TURNS = TURNS_PER_YEAR / 2;
/** Shrinks a short record toward zero: score = rel x turns / (turns + this). */
export const CEO_RECORD_CONFIDENCE_TURNS = TURNS_PER_YEAR;
/** Sample and stored relative margin bound, percentage points. */
export const CEO_RECORD_REL_CLAMP_PP = 50;
/** Sector margin bound, percent, so one collapsed sector cannot swamp a sample. */
const SECTOR_MARGIN_CLAMP_PCT = 100;

export function isCeoRecordTurn(turn: number): boolean {
  return turn > 0 && turn % CEO_RECORD_CADENCE_TURNS === 0;
}

export interface CeoRecordSector {
  corporationId: { toString(): string };
  countryId: string;
  sectorType: CorporationType;
  industryModel?: string | null;
  mediaDiscriminator?: string | null;
  revenue: number;
  realizedRevenue?: number;
  profitMargin: number;
  effectiveProfitMargin?: number;
  mothballed?: boolean;
  plantsPnl?: { revenue: number; profit: number } | null;
}

export interface CeoRecordCorporation {
  _id: { toString(): string };
  ceoType?: string;
  ceoId?: { toString(): string } | null;
  suspended?: boolean;
}

const clamp = (value: number, bound: number) => Math.max(-bound, Math.min(bound, value));

/**
 * Operating margin of one sector, percent, or null when it earned nothing to
 * measure. Net margin from the physical P&L when present (it nets unsold
 * output), else the margin the engine applied last turn.
 */
export function sectorOperatingMarginPct(sector: CeoRecordSector): number | null {
  if (sector.mothballed) return null;
  const revenue = sector.realizedRevenue ?? sector.revenue;
  if (!(revenue > 0)) return null;
  const pnl = sector.plantsPnl;
  const margin =
    pnl && pnl.revenue > 0
      ? (pnl.profit / pnl.revenue) * 100
      : (sector.effectiveProfitMargin ?? sector.profitMargin);
  return Number.isFinite(margin) ? clamp(margin, SECTOR_MARGIN_CLAMP_PCT) : null;
}

export interface CeoSample {
  nppId: string;
  lane: OperatingSectorType;
  relMarginPp: number;
}

/**
 * One sample per (NPP CEO, lane): the mean, over the CEO's company sectors in
 * that lane, of the sector margin minus the mean margin of OTHER companies'
 * sectors in the same country and lane. Sectors with no peers are skipped.
 */
export function computeCeoSamples(
  corporations: readonly CeoRecordCorporation[],
  sectorsByCorp: ReadonlyMap<string, readonly CeoRecordSector[]>
): CeoSample[] {
  const groupKey = (s: CeoRecordSector) =>
    `${s.countryId}|${operatingSectorTypeFor(s.sectorType, s.industryModel, s.mediaDiscriminator)}`;
  const group = new Map<string, { sum: number; count: number }>();
  for (const sectors of sectorsByCorp.values()) {
    for (const sector of sectors) {
      const margin = sectorOperatingMarginPct(sector);
      if (margin == null) continue;
      const key = groupKey(sector);
      const g = group.get(key) ?? { sum: 0, count: 0 };
      g.sum += margin;
      g.count += 1;
      group.set(key, g);
    }
  }

  const byNppLane = new Map<string, { nppId: string; lane: OperatingSectorType; rels: number[] }>();
  for (const corp of corporations) {
    if (corp.ceoType !== "npp" || corp.ceoId == null || corp.suspended === true) continue;
    const sectors = sectorsByCorp.get(corp._id.toString()) ?? [];
    const own = new Map<string, { sum: number; count: number; margins: number[] }>();
    for (const sector of sectors) {
      const margin = sectorOperatingMarginPct(sector);
      if (margin == null) continue;
      const key = groupKey(sector);
      const o = own.get(key) ?? { sum: 0, count: 0, margins: [] };
      o.sum += margin;
      o.count += 1;
      o.margins.push(margin);
      own.set(key, o);
    }
    const nppId = corp.ceoId.toString();
    for (const [key, o] of own) {
      const g = group.get(key);
      const peerCount = (g?.count ?? 0) - o.count;
      if (!g || peerCount <= 0) continue;
      const peerMean = (g.sum - o.sum) / peerCount;
      const lane = key.slice(key.indexOf("|") + 1) as OperatingSectorType;
      const slot = `${nppId}|${lane}`;
      const entry = byNppLane.get(slot) ?? { nppId, lane, rels: [] };
      for (const margin of o.margins) entry.rels.push(margin - peerMean);
      byNppLane.set(slot, entry);
    }
  }

  return [...byNppLane.values()].map(({ nppId, lane, rels }) => ({
    nppId,
    lane,
    relMarginPp: clamp(rels.reduce((a, b) => a + b, 0) / rels.length, CEO_RECORD_REL_CLAMP_PP),
  }));
}

/**
 * Fold one sample into a lane record. A sample already taken this turn is a
 * no-op, so a replayed pass cannot double-count.
 */
export function applyCeoSample(
  record: NppCeoSectorRecord | undefined,
  relMarginPp: number,
  turn: number
): NppCeoSectorRecord {
  if (record && record.lastTurn === turn) return record;
  const sample = clamp(relMarginPp, CEO_RECORD_REL_CLAMP_PP);
  const step = CEO_RECORD_CADENCE_TURNS;
  const prior = record ? Math.min(record.turns, CEO_RECORD_WEIGHT_CAP_TURNS) : 0;
  const mean = record ? (record.relMarginPp * prior + sample * step) / (prior + step) : sample;
  return {
    turns: Math.min((record?.turns ?? 0) + step, CEO_RECORD_MAX_TURNS),
    relMarginPp: Math.round(clamp(mean, CEO_RECORD_REL_CLAMP_PP) * 100) / 100,
    lastTurn: turn,
  };
}

/**
 * Confidence-weighted record score for a lane, or null when there is no
 * record long enough to count.
 */
export function ceoRecordScore(
  record: NppCeoTrackRecord | undefined,
  lane: OperatingSectorType
): number | null {
  const line = record?.[lane];
  if (!line || line.turns < CEO_RECORD_MIN_TURNS) return null;
  return (line.relMarginPp * line.turns) / (line.turns + CEO_RECORD_CONFIDENCE_TURNS);
}

/** Only a record that beat the peers is a reason to choose someone. */
export function hasGoodCeoRecord(
  record: NppCeoTrackRecord | undefined,
  lane: OperatingSectorType
): boolean {
  const score = ceoRecordScore(record, lane);
  return score != null && score > 0;
}
