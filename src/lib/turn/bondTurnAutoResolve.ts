import type { Db } from "mongodb";
import type { Bond, Corporation } from "@/lib/db/types";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { recordAuditBulk } from "@/lib/audit/recordAudit";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";

/**
 * Phase 7: Auto-resolve lingering corporate defaults.
 *
 * A corp that defaulted on a PRIOR turn (defaultedAtTurn < turn) has already
 * had at least one turn for its CEO to act in the crisis modal — so it can no
 * longer dodge resolution by simply closing the tab. Resolution order:
 *   1. REFINANCE (no sale): issue a replacement bond and roll holders in when
 *      the corp is within its leverage limits & refinance cap. Preserves every
 *      sector — the least destructive outcome.
 *   2. RESTRUCTURE (sell): if refinance is infeasible, sell the minimum set of
 *      sectors that repays bondholders in full.
 *   3. STAND for dissolution: if neither works, the default stands for the CEO
 *      to dissolve & settle.
 * National and IMF-managed corps are never auto-resolved. Every auto-resolution
 * now notifies the owning CEO and writes an audit row (ticket #900: the silent
 * sector sales that nobody was told about).
 */
export async function autoResolveLingeringDefaults(args: {
  db: Db;
  turn: number;
  now: Date;
}): Promise<{ bondsAutoRestructured: number; bondsAutoRefinanced: number }> {
  const { db, turn, now } = args;
  let bondsAutoRestructured = 0;
  let bondsAutoRefinanced = 0;
  const phase7Notifications: NotificationInput[] = [];
  const lingeringDefaultCorpIds = await db.collection<Bond>("bonds").distinct("corporationId", {
    matured: false,
    defaulted: true,
    defaultedAtTurn: { $lt: turn },
    issuerType: { $ne: "sovereign" },
  });
  if (lingeringDefaultCorpIds.length > 0) {
    const [
      { executeCorporationBondRestructure },
      { executeCorporationBondRefinance },
      { withCorporationSettlementLock },
    ] = await Promise.all([
      import("@/lib/bonds/executeCorporationBondRestructure"),
      import("@/lib/bonds/executeCorporationBondRefinance"),
      import("@/lib/corporations/settlementLock"),
    ]);
    const candidateCorps = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: lingeringDefaultCorpIds } })
      .toArray();
    const auditRows: Record<string, unknown>[] = [];
    // Forensics/alt-detection audit spine (plan §3.1, T2.7) — the "silent
    // state change" scenario: an auto-restructure/refinance mutates a
    // player's corp (sells sectors, replaces a bond) with nobody having
    // acted. `adminLogs` above already covers this (ticket #900), but it
    // isn't queryable from the unified spine/Forensic Explorer, so mirror
    // each row into `actionAuditEntries` and flush with ONE `recordAuditBulk`
    // call after the loop (never per-corp DB round trips).
    const actionAuditEntries: ActionAuditInput[] = [];
    for (const corp of candidateCorps) {
      if (corp.countryOwnerId || corp.imfBailoutActive === true) continue;

      // Pick the longest maturity among this corp's defaulted bonds as the
      // replacement bond's term (defaults to 96 / 2yr when none is a valid
      // BondMaturityTurns) so a refinanced long-dated bond isn't silently
      // shortened.
      const corpDefaultedBonds = await db
        .collection<Bond>("bonds")
        .find({ corporationId: corp._id, matured: false, defaulted: true })
        .project({ maturityTurns: 1 })
        .toArray();
      const validMaturities: BondMaturityTurns[] = [48, 96, 240, 336];
      let refiMaturityTurns: BondMaturityTurns = 96;
      for (const b of corpDefaultedBonds) {
        const mt = b.maturityTurns as number | undefined;
        if (
          mt != null &&
          validMaturities.includes(mt as BondMaturityTurns) &&
          mt > refiMaturityTurns
        ) {
          refiMaturityTurns = mt as BondMaturityTurns;
        }
      }

      try {
        await withCorporationSettlementLock(
          db,
          corp._id,
          "bondSettlementInProgressAt",
          now,
          async () => {
            // 1. Prefer refinance — no sectors sold.
            const refi = await executeCorporationBondRefinance(db, corp, {
              now,
              currentTurn: turn,
              maturityTurns: refiMaturityTurns,
            });
            if (refi.ok) {
              bondsAutoRefinanced += refi.bondsMatured;
              if (corp.userId) {
                phase7Notifications.push({
                  userId: corp.userId,
                  type: "corp_bond_auto_refinanced",
                  title: "Bonds auto-refinanced",
                  message: `${corp.name}'s defaulted bonds were automatically refinanced into a new ${refiMaturityTurns}-turn bond (coupon ${refi.couponRate.toFixed(1)}%). No sectors were sold — the debt was rolled into a replacement issuance.`,
                  // Without recipientCharacterId the inbox's per-character
                  // filter and unread badge exclude this entirely, so the CEO
                  // never sees it (ticket #1130).
                  metadata: {
                    recipientCharacterId: corp.ceoId?.toString(),
                    corporationId: corp._id.toString(),
                  },
                });
              }
              auditRows.push({
                action: "bond-default-auto-resolved",
                corporationId: corp._id,
                corporationName: corp.name,
                method: "refinance",
                turn,
                detail: {
                  bondId: refi.bondId,
                  faceValueAnchor: refi.faceValueAnchor,
                  couponRate: refi.couponRate,
                  maturityTurn: refi.maturityTurn,
                  bondsMatured: refi.bondsMatured,
                  retiredBondIds: refi.retiredBondIds,
                },
                createdAt: now,
              });
              actionAuditEntries.push({
                source: "turn",
                category: "corp",
                action: "corp.auto_refinance",
                phase: "bondTurn",
                subject: { type: "corporation", id: corp._id.toString(), name: corp.name },
                outcome: "ok",
                turn,
                meta: {
                  bondId: refi.bondId,
                  faceValueAnchor: refi.faceValueAnchor,
                  couponRate: refi.couponRate,
                  bondsMatured: refi.bondsMatured,
                },
              });
              return;
            }

            // 2. Refinance infeasible — sell the minimum sectors to repay.
            const result = await executeCorporationBondRestructure(db, corp, {
              now,
              cureTurn: turn,
            });
            bondsAutoRestructured += result.bondsMatured;
            if (corp.userId) {
              phase7Notifications.push({
                userId: corp.userId,
                type: "corp_bond_auto_restructured",
                title: "Sectors sold to cover bond default",
                message: `${corp.name} could not refinance its defaulted bonds, so ${result.sectorsLiquidated} sector${result.sectorsLiquidated === 1 ? "" : "s"} ${result.sectorsLiquidated === 1 ? "was" : "were"} sold to repay bondholders in full. The corporation survives with its remaining sectors.`,
                metadata: {
                  recipientCharacterId: corp.ceoId?.toString(),
                  corporationId: corp._id.toString(),
                },
              });
            }
            auditRows.push({
              action: "bond-default-auto-resolved",
              corporationId: corp._id,
              corporationName: corp.name,
              method: "restructure",
              turn,
              detail: {
                bondsMatured: result.bondsMatured,
                sectorsLiquidated: result.sectorsLiquidated,
                paid: result.paid,
                proceeds: result.proceeds,
              },
              createdAt: now,
            });
            actionAuditEntries.push({
              source: "turn",
              category: "corp",
              action: "corp.auto_restructure",
              phase: "bondTurn",
              subject: { type: "corporation", id: corp._id.toString(), name: corp.name },
              outcome: "ok",
              turn,
              meta: {
                bondsMatured: result.bondsMatured,
                sectorsLiquidated: result.sectorsLiquidated,
                paid: result.paid,
                proceeds: result.proceeds,
              },
            });
          }
        );
      } catch {
        // 3. Refinance AND restructure both infeasible (insufficient sector
        // value) or a transient error — leave the default standing for the CEO
        // to dissolve & settle.
      }
    }

    if (auditRows.length > 0) {
      try {
        await db.collection("adminLogs").insertMany(auditRows);
      } catch (err) {
        // Audit is best-effort; never crash a turn over the log write.
        console.error("[bondTurn] Phase 7 audit log insert failed:", err);
      }
    }
    if (actionAuditEntries.length > 0) {
      recordAuditBulk(actionAuditEntries);
    }
  }

  // Flush Phase-7 CEO notifications separately from the phases 4/5 batch
  // (which was already flushed by the caller). Empty arrays are a no-op.
  await createNotifications(phase7Notifications);

  return { bondsAutoRestructured, bondsAutoRefinanced };
}
