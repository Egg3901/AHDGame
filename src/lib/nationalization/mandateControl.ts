import type { Db, ObjectId } from "mongodb";
import type { Corporation, CorporateSector, SoeMandate } from "@/lib/db/types";

/**
 * State-official mandate setters for National Corporations (spec §11.4 / §24).
 * Corp-level default is normalized (unset when no posture); per-sector overrides
 * keep explicit booleans so an override can turn a posture OFF against the
 * corp default — `resolveSectorMandate` falls back via nullish-coalescing, so a
 * literal `false` is distinct from "inherit". `clearSectorMandate` is the
 * revert-to-default action. Authorization is the caller's responsibility (routes
 * use `assertTreasuryAuthority`).
 */

function activePosture(mandate: SoeMandate): SoeMandate | null {
  const priceControlled = !!mandate.priceControlled;
  const employmentGuaranteed = !!mandate.employmentGuaranteed;
  if (!priceControlled && !employmentGuaranteed) return null;
  return { priceControlled, employmentGuaranteed };
}

/** Set (or clear, when no posture) the corp-wide default mandate. */
export async function setCorpMandate(db: Db, corpId: ObjectId, mandate: SoeMandate): Promise<void> {
  const corps = db.collection<Corporation>("corporations");
  const now = new Date();
  const posture = activePosture(mandate);
  if (posture) {
    await corps.updateOne({ _id: corpId }, { $set: { soeMandate: posture, updatedAt: now } });
  } else {
    await corps.updateOne(
      { _id: corpId },
      { $unset: { soeMandate: "" }, $set: { updatedAt: now } }
    );
  }
}

/** Set an explicit per-sector override. Throws if the sector isn't held by this corp. */
export async function setSectorMandate(
  db: Db,
  corpId: ObjectId,
  sectorId: ObjectId,
  mandate: SoeMandate
): Promise<void> {
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const sector = await sectors.findOne({ _id: sectorId, corporationId: corpId });
  if (!sector) throw new Error("Sector not found for this National Corporation");
  await sectors.updateOne(
    { _id: sectorId },
    {
      $set: {
        soeMandate: {
          priceControlled: !!mandate.priceControlled,
          employmentGuaranteed: !!mandate.employmentGuaranteed,
        },
        updatedAt: new Date(),
      },
    }
  );
}

/** Remove a per-sector override so the sector reverts to the corp default. */
export async function clearSectorMandate(
  db: Db,
  corpId: ObjectId,
  sectorId: ObjectId
): Promise<void> {
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const sector = await sectors.findOne({ _id: sectorId, corporationId: corpId });
  if (!sector) throw new Error("Sector not found for this National Corporation");
  await sectors.updateOne(
    { _id: sectorId },
    { $unset: { soeMandate: "" }, $set: { updatedAt: new Date() } }
  );
}
