/**
 * Cabinet account repair. Adds zero-value institutional accounts omitted by the
 * law-owner-only seed, preserving every existing balance and world receipt.
 */
import type { GameState } from "@/lib/db/types/gameState";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import type { ResetNationalTreasurySnapshot } from "@/lib/resetFinance/rules/treasurySnapshot";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { missingCabinetAccounts } from "@/lib/resetCabinet/rules/accountRoster";
import { RESET_V2_COUNTRIES, resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-10-complete-cabinet-v2-accounts",
  description:
    "Complete v2 Cabinet institutional accounts without creating funds or changing claims.",
  idempotent: true,
  async execute(db, ctx) {
    return runRequiredTransaction(
      async (session) => {
        const states = db.collection<GameState>("gameState");
        const state = await states.findOne({ _id: "current" }, { session });
        const countries = RESET_V2_COUNTRIES.filter(
          (country) =>
            resetSystemVersionsForCountry(state, RESET_V2_READY, country).cabinet === "v2"
        );
        if (!state?.resetWorldId || countries.length === 0) {
          return { documentsInserted: 0, notes: ["No verified Cabinet v2 countries to repair."] };
        }
        if (state.isProcessing)
          throw new Error("Wait for the active turn before repairing Cabinet accounts");
        // Take the existing turn guard only inside this transaction. Other
        // workflows conflict on gameState; the temporary guard is never visible.
        if (!ctx.dryRun) {
          const locked = await states.updateOne(
            {
              _id: "current",
              resetWorldId: state.resetWorldId,
              currentTurn: state.currentTurn,
              isProcessing: { $ne: true },
            },
            { $set: { isProcessing: true } },
            { session }
          );
          if (locked.matchedCount !== 1) throw new Error("Cabinet repair lost the world guard");
        }
        const accountsCollection =
          db.collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts");
        const treasuryCollection =
          db.collection<ResetNationalTreasurySnapshot>("resetNationalTreasuries");
        const accounts = await accountsCollection
          .find({ worldId: state.resetWorldId, countryId: { $in: countries } }, { session })
          .toArray();
        const treasuries = await treasuryCollection
          .find({ worldId: state.resetWorldId, countryId: { $in: countries } }, { session })
          .toArray();
        const additions = countries.flatMap((countryId) => {
          const treasury = treasuries.find((row) => row._id === countryId);
          if (!treasury || treasury.settledThroughTurn !== state.currentTurn) {
            throw new Error(`Cabinet repair needs a settled current-world treasury: ${countryId}`);
          }
          return missingCabinetAccounts({
            definitions: DEPARTMENT_DEFINITIONS,
            accounts,
            worldId: state.resetWorldId!,
            countryId,
            sourceTurn: treasury.sourceTurn,
            currentTurn: state.currentTurn,
          });
        });
        if (!ctx.dryRun && additions.length > 0) {
          // _id is the reviewed primary key. Inserting rather than upserting
          // refuses a stale-world collision and cannot overwrite existing money.
          await accountsCollection.insertMany(additions, { session, ordered: true });
          const written = await treasuryCollection.bulkWrite(
            countries.map((countryId) => ({
              updateOne: {
                filter: {
                  _id: countryId,
                  worldId: state.resetWorldId,
                  settledThroughTurn: state.currentTurn,
                },
                update: {
                  $addToSet: {
                    departmentAccountIds: {
                      $each: additions
                        .filter((row) => row.countryId === countryId)
                        .map((row) => row._id),
                    },
                  },
                },
              },
            })),
            { session, ordered: true }
          );
          if (written.matchedCount !== countries.length) {
            throw new Error("Cabinet repair lost a current-world treasury");
          }
        }
        if (!ctx.dryRun) {
          await states.updateOne(
            { _id: "current", resetWorldId: state.resetWorldId },
            state.isProcessing === undefined
              ? { $unset: { isProcessing: "" } }
              : { $set: { isProcessing: state.isProcessing } },
            { session }
          );
        }
        return {
          documentsScanned: accounts.length + treasuries.length,
          documentsInserted: ctx.dryRun ? 0 : additions.length,
          notes: [
            `${ctx.dryRun ? "Would add" : "Added"} ${additions.length} zero-value Cabinet accounts. Existing balances, claims, action state and seed receipts are preserved.`,
          ],
        };
      },
      { timeoutMS: 60_000 }
    );
  },
};
