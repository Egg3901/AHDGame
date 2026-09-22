import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  getManifesto,
  upsertManifestoDraft,
  lockManifesto,
  validateManifestoPledges,
} from "@/lib/db/collections/manifestos";
import { pledgeCatalogFor } from "@/lib/countries/uk/manifesto/pledgeCatalog";
import { selectNppPledges } from "@/lib/countries/uk/manifesto/nppManifesto";

/**
 * Manifesto lifecycle at election call (epic #856, ticket #857).
 *
 * When a UK election is called, every party's manifesto is finalised:
 *  - a player-led party with a COMPLETE valid draft has it LOCKED (locks at
 *    election call, immutable through the campaign);
 *  - an NPP (AI) party with no locked manifesto gets one AUTO-GENERATED from its
 *    own ideology and locked (symmetry — NPPs are judged on delivery too).
 *
 * A player-led party whose draft is incomplete/absent is simply left without a
 * manifesto (no effect, no penalty) — we never invent pledges on a human's behalf.
 *
 * Pure orchestration over the manifestos collection; the caller supplies the
 * party roster + ideology. Placement of the call at the exact dissolution point
 * is wired separately.
 */

export interface ManifestoLifecycleParty {
  /** Party key (matches Manifesto.party / ElectionCandidate.party). */
  party: string;
  isNpp: boolean;
  /** NPP ideology used to auto-select pledges. Ignored for player parties. */
  economic?: number;
  social?: number;
}

export interface ManifestoLifecycleResult {
  lockedPlayerParties: string[];
  generatedNppParties: string[];
  skipped: string[];
}

export async function finaliseManifestosAtElectionCall(
  db: Db,
  args: {
    countryId: CountryId;
    electionId: ObjectId;
    parties: ManifestoLifecycleParty[];
    now: Date;
    /**
     * Standing platforms by party key (ticket #862): the pledge sets each
     * party's conference ratified between elections. The leader finalises
     * the election manifesto FROM the platform at dissolution: a player
     * party with NO draft of its own gets one seeded from its platform and
     * locked; the leader's own draft always wins and is never overwritten.
     * NPP parties use their platform when valid, else fall back to
     * ideology-generated pledges.
     */
    standingPlatformByParty?: Map<string, string[]>;
  }
): Promise<ManifestoLifecycleResult> {
  const { countryId, electionId, now } = args;
  const catalog = pledgeCatalogFor(countryId);
  const validIds = new Set(catalog.map((e) => e.id));

  const result: ManifestoLifecycleResult = {
    lockedPlayerParties: [],
    generatedNppParties: [],
    skipped: [],
  };

  const platformOf = (party: string): string[] | null => {
    const ids = args.standingPlatformByParty?.get(party);
    if (!ids) return null;
    const validation = validateManifestoPledges(
      ids.map((catalogEntryId) => ({ catalogEntryId })),
      validIds
    );
    return validation.ok ? ids : null;
  };

  for (const p of args.parties) {
    const existing = await getManifesto(db, countryId, electionId, p.party);
    if (existing?.lockedAt) {
      result.skipped.push(p.party);
      continue;
    }

    if (p.isNpp) {
      // Prefer the conference-ratified standing platform; fall back to
      // generating from the party's ideology (default centrist if unknown).
      const pledgeIds =
        platformOf(p.party) ?? selectNppPledges(catalog, p.economic ?? 0, p.social ?? 0);
      if (pledgeIds.length === 0) {
        result.skipped.push(p.party);
        continue;
      }
      await upsertManifestoDraft(db, {
        countryId,
        electionId,
        party: p.party,
        pledges: pledgeIds.map((id) => ({ catalogEntryId: id })),
        authorCharacterId: null,
        isNPP: true,
        now,
      });
      const locked = await lockManifesto(db, {
        countryId,
        electionId,
        party: p.party,
        validCatalogIds: validIds,
        now,
      });
      if (locked.ok) result.generatedNppParties.push(p.party);
      else result.skipped.push(p.party);
      continue;
    }

    // Player party: the leader's own draft wins. With no draft at all, seed
    // one from the conference-ratified standing platform (the leader
    // finalises the election manifesto from the platform at dissolution);
    // an incomplete leader draft is still left alone, never overwritten.
    if (!existing) {
      const platformIds = platformOf(p.party);
      if (platformIds) {
        await upsertManifestoDraft(db, {
          countryId,
          electionId,
          party: p.party,
          pledges: platformIds.map((id) => ({ catalogEntryId: id })),
          authorCharacterId: null,
          now,
        });
      }
    }
    const locked = await lockManifesto(db, {
      countryId,
      electionId,
      party: p.party,
      validCatalogIds: validIds,
      now,
    });
    if (locked.ok && (existing || platformOf(p.party))) {
      result.lockedPlayerParties.push(p.party);
    } else {
      result.skipped.push(p.party);
    }
  }

  return result;
}
