/**
 * Absent-party registration healing returns the entire share to Independent.
 * planAbsentRegistrationHeal preserves each regional total and skips invalid pools.
 * It changes neither Org nor Unregistered and is idempotent on healed input.
 */
import { registrationPresenceKey } from "./registrationPresence";

export interface HealPartyRow {
  _id: string;
  countryId: string;
  stateId: string;
  partyId: string;
  registration?: number;
  organization?: number;
}

export interface HealPool {
  _id: string;
  countryId: string;
  stateId: string;
  independent: number;
  unregistered: number;
}

export function planAbsentRegistrationHeal(
  rows: readonly HealPartyRow[],
  pools: readonly HealPool[],
  presence: ReadonlySet<string>
) {
  const regions = new Map<string, HealPartyRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.countryId, row.stateId]);
    const list = regions.get(key) ?? [];
    list.push(row);
    regions.set(key, list);
  }
  const transfers: { row: HealPartyRow; amount: number }[] = [];
  const poolChanges: { pool: HealPool; amount: number }[] = [];
  const blocked: { countryId: string; stateId: string; reason: string }[] = [];
  for (const group of regions.values()) {
    const first = group[0];
    const absent = group.filter(
      (r) =>
        r.partyId !== "independent" &&
        (r.registration ?? 0) > 0 &&
        !presence.has(registrationPresenceKey(r.countryId, r.partyId, r.stateId))
    );
    if (!absent.length) continue;
    const matching = pools.filter(
      (p) => p.countryId === first.countryId && p.stateId === first.stateId
    );
    const pool = matching[0];
    const values = [
      ...group.map((r) => r.registration ?? 0),
      pool?.independent,
      pool?.unregistered,
    ];
    const valid =
      first.countryId &&
      first.stateId &&
      matching.length === 1 &&
      group.every((r) => typeof r.partyId === "string" && r.partyId.length > 0) &&
      new Set(group.map((r) => r.partyId)).size === group.length &&
      values.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100);
    const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    if (!valid || Math.abs(total - 100) > 0.000001) {
      blocked.push({
        countryId: first.countryId,
        stateId: first.stateId,
        reason:
          "Missing, duplicate or invalid registration pool/party data, or total differs from 100",
      });
      continue;
    }
    const amount = absent.reduce((sum, r) => sum + r.registration!, 0);
    for (const row of absent) transfers.push({ row, amount: row.registration! });
    poolChanges.push({ pool, amount });
  }
  return { transfers, poolChanges, blocked };
}
