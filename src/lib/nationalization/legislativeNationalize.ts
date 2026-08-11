/**
 * Legislative nationalization (spec §9.2): the enactment of a `nationalize` bill
 * provision. Passage IS the authorization — no eligibility gate — so this reaches
 * any corp at the FAIR tier. Guards: target exists, is in the bill's country, and
 * is not already state-owned. Politics flow through the P3a consequences module
 * via the transition primitive (method "legislative", owner-derived triggers,
 * resolved governing party for the ideology multiplier).
 */
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector, PendingNationalization } from "@/lib/db/types";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";
import type { NationalizeProvision } from "@/lib/db/types/legislation";
import type { CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { createNotification } from "@/lib/notifications";
import { isStateOwned } from "./nationalCorporation";
import { nationalizeSector, nationalizeWholeCorp } from "./ownershipTransition";
import type { NationalizationTrigger } from "./consequences/types";
import { getDesignatedSectorTypes, corpHasStrategicSector } from "./strategicSectors";
import { getTopMarketSharePercent } from "./monopolyTrigger";
import { MONOPOLY_SHARE_THRESHOLD } from "./constants";
import { computeNoticeTurns } from "./noticeWindow";
import { isWithinRenationalizeCooldown } from "./privatizationShares";
import { nationalizeSectorWide } from "./nationalizeSectorWide";

export async function applyNationalizeProvision(
  db: Db,
  countryId: CountryId,
  provision: NationalizeProvision
): Promise<void> {
  // Industry-wide sector taking (sector-wide design): carve a fraction of every
  // in-scope holding of the type into the NatCorp. The passed bill is the
  // authority — no eligibility gate, no per-corp notice window (immediate).
  if (provision.targetSectorType) {
    const turn = await getCurrentTurn(db);
    const governingPartyId = await resolveGoverningPartyId(db, countryId);
    await nationalizeSectorWide(db, {
      countryId,
      sectorType: provision.targetSectorType,
      carveFraction: provision.sectorCarveFraction ?? 1,
      scope: provision.sectorScope ?? "all",
      tier: "fair",
      consequence: { method: "legislative", triggers: ["supermajority"], turn, governingPartyId },
    });
    return;
  }

  const corps = db.collection<Corporation>("corporations");

  // Resolve the target corp (directly, or via the sector's owner).
  let targetCorp: Corporation | null = null;
  let targetSector: CorporateSector | null = null;
  if (provision.targetSectorId) {
    targetSector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: provision.targetSectorId });
    if (targetSector) targetCorp = await corps.findOne({ _id: targetSector.corporationId });
  } else if (provision.targetCorporationId) {
    targetCorp = await corps.findOne({ _id: provision.targetCorporationId });
  }
  if (!targetCorp) return; // target gone by enactment time — no-op

  // Already state-owned ⇒ nothing to take (the transition would throw anyway).
  if (isStateOwned(targetCorp)) return;

  // Jurisdiction: a country's law may only take assets within that country. For a
  // sector, the sector must operate here; for a whole corp, it must be HQ'd here.
  if (provision.targetSectorId && targetSector) {
    if (targetSector.countryId !== countryId) return;
  } else if (targetCorp.countryId !== countryId) {
    return;
  }

  const turn = await getCurrentTurn(db);

  // Re-nationalization cooldown (spec §13.4): a just-privatized corp is protected
  // from immediate re-seizure. No-op (the bill provision simply does not apply).
  if (isWithinRenationalizeCooldown(targetCorp, turn)) return;

  const governingPartyId = await resolveGoverningPartyId(db, countryId);

  // Compute the strategic/monopoly conditions for political framing (P4a). Full
  // reach is locked, so these never GATE the taking — they only shape the
  // consequences (a monopoly break-up polls well; a strategic taking is
  // contested). The donor's whole-corp footprint frames a sector taking too.
  const corpSectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: targetCorp._id })
    .toArray();
  const designatedTypes = await getDesignatedSectorTypes(db, countryId);
  const strategicMatch = corpHasStrategicSector(designatedTypes, countryId, corpSectors);
  const topShare = await getTopMarketSharePercent(db, targetCorp, corpSectors);

  // A PLAYER taking carries the conditions that fired (falling back to the
  // "supermajority" democratic-authorization marker so it still reads as a real
  // expropriation in the consequences layer). An NPC / unowned target has no
  // private owner → stays politics-neutral (never add monopoly/strategic, which
  // would wrongly fire the P3a expropriation backlash).
  let triggers: NationalizationTrigger[];
  if (targetCorp.userId != null) {
    const fired: NationalizationTrigger[] = [];
    if (strategicMatch) fired.push("strategic");
    if (topShare >= MONOPOLY_SHARE_THRESHOLD * 100) fired.push("monopoly");
    triggers = fired.length > 0 ? fired : ["supermajority"];
  } else {
    triggers = ["npc"];
  }

  const consequence = {
    method: "legislative" as const,
    triggers,
    turn,
    governingPartyId,
  };

  // Player corps get a notice window (spec §14): post a pending-taking + notify
  // the CEO; the resolver completes or cancels it at the deadline. NPC/unowned
  // takings have no owner to protect → execute immediately below.
  if (targetCorp.userId != null) {
    const noticeTurns = computeNoticeTurns(triggers);
    if (noticeTurns > 0) {
      await db.collection<PendingNationalization>("pendingNationalizations").insertOne({
        _id: new ObjectId(),
        countryId,
        ...(provision.targetSectorId
          ? { targetSectorId: provision.targetSectorId }
          : { targetCorporationId: targetCorp._id }),
        tier: "fair",
        method: "legislative",
        triggers,
        governingPartyId,
        postedAtTurn: turn,
        noticeDeadlineTurn: turn + noticeTurns,
        status: "pending",
        createdAt: new Date(),
      });
      await createNotification({
        userId: targetCorp.userId,
        type: "corp_nationalization_notice",
        title: "Nationalization notice",
        message: `${targetCorp.name} faces nationalization in ${noticeTurns} turns. Act now to contest it.`,
        metadata: {
          corporationId: targetCorp._id.toString(),
          noticeDeadlineTurn: turn + noticeTurns,
        },
      });
      return;
    }
  }

  if (provision.targetSectorId && targetSector) {
    await nationalizeSector(db, {
      countryId,
      sectorId: targetSector._id,
      tier: "fair",
      consequence,
    });
    return;
  }

  await nationalizeWholeCorp(db, {
    countryId,
    corporationId: targetCorp._id,
    tier: "fair",
    consequence,
  });
}

/** Active regime's governing party (most-recently-updated leader-state). */
async function resolveGoverningPartyId(db: Db, countryId: CountryId): Promise<string | null> {
  const leader = await db
    .collection<CountryLeaderState>("countryLeaderStates")
    .findOne({ countryId }, { sort: { updatedAt: -1 } });
  return leader?.governingPartyId ?? null;
}
