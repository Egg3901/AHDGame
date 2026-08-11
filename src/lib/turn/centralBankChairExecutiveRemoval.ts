/**
 * Central Bank Chair — Executive Incompatibility Sweep
 *
 * Runs each turn immediately before chair selection. A player may file for and
 * contest any election while holding the Chair, but the central bank must be
 * independent of the executive branch: the moment a sitting Chair actually
 * holds a national executive office (head of government, its deputy, or a
 * ceremonial head of state), they are removed from the Chair and the seat is
 * refilled by the normal selection pass that runs right after.
 *
 * Also clears a still-pending chair proposal whose nominee has since taken an
 * executive office, closing the proposal→accept gap.
 */
import type { Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getExecutiveCharacterIds } from "@/lib/elections/executiveOffice";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import { persistVacancy } from "@/lib/turn/centralBankChairSelection";
import { createNotifications } from "@/lib/notifications";
import { createSystemNewsPost } from "@/lib/news";
import { logger } from "../observability/logger";

export interface CentralBankChairExecutiveRemovalResult {
  banksChecked: number;
  chairsRemoved: number;
  pendingCleared: number;
}

export async function processCentralBankChairExecutiveRemoval(
  db: Db,
  _currentTurn: number,
  gameNow: Date
): Promise<CentralBankChairExecutiveRemovalResult> {
  const result: CentralBankChairExecutiveRemovalResult = {
    banksChecked: 0,
    chairsRemoved: 0,
    pendingCleared: 0,
  };

  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({
      $or: [{ chairCharacterId: { $ne: null } }, { chairSelectionPending: { $ne: null } }],
    })
    .toArray();

  for (const bank of banks) {
    // NPP technocrat chairs hold no executive office, so there is nothing to
    // strip — skip the sweep entirely for banks governed by an NPP chair.
    if (bank.chairMode === "npp") continue;

    result.banksChecked++;

    // Same detector as chair selection — currentOffice executives (incl. the
    // Tánaiste-as-cabinet shape) AND electedOfficials executives (CN's
    // ceremonial President, which is keyed off the CCP chair and never written
    // to currentOffice). Scoped to the bank's member countries so multi-country
    // (intorg) banks like the ECB are handled correctly.
    const scope = await getCentralBankScope(db, bank.countryId);
    const executiveIds = await getExecutiveCharacterIds(db, scope.memberCountries);

    // 1. Seated chair who has taken an executive office.
    if (bank.chairCharacterId && executiveIds.has(bank.chairCharacterId.toString())) {
      const chair = await db
        .collection<Character>("characters")
        .findOne({ _id: bank.chairCharacterId }, { projection: { _id: 1, name: 1, userId: 1 } });
      await persistVacancy(db, bank._id, gameNow);
      result.chairsRemoved++;
      if (chair) await notifyChairRemoved(db, bank, chair);
      continue; // bank is now vacant; pending was already null
    }

    // 2. Pending nominee who has taken an executive office before accepting.
    if (
      bank.chairSelectionPending &&
      executiveIds.has(bank.chairSelectionPending.characterId.toString())
    ) {
      await persistVacancy(db, bank._id, gameNow);
      result.pendingCleared++;
    }
  }

  return result;
}

async function notifyChairRemoved(
  db: Db,
  bank: CentralBank,
  chair: Pick<Character, "_id" | "name" | "userId">
): Promise<void> {
  const config = COUNTRY_CONFIGS[bank.countryId];
  const chairTitle = config.centralBank.chairTitle;
  const intorgId = config.centralBank.centralBankIntorgId;

  if (chair.userId) {
    await createNotifications([
      {
        userId: chair.userId,
        type: "system",
        title: `Stepped down as ${chairTitle}`,
        message: `You have left the ${chairTitle} of the ${config.centralBank.name} upon taking national executive office. The central bank must remain independent of the executive branch.`,
        metadata: intorgId
          ? { type: "central_bank_chair_removed", intorgId }
          : { type: "central_bank_chair_removed", countryId: bank.countryId },
      },
    ]);
  }

  await createSystemNewsPost(
    `${chair.name} has stepped down as ${chairTitle} of the ${config.centralBank.name} after taking national executive office.`,
    "election"
  ).catch((err) => logger.error("CentralBankChairExecutiveRemoval", "Failed to create news", err));
}
