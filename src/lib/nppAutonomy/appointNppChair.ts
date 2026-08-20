import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { NPP } from "@/lib/db/types/npp";
import { spawnTechnocratNpp } from "@/lib/npp/generator";
import {
  deriveChairAlignment,
  oppositeAlignment,
  type ChairAlignment,
} from "@/lib/centralBank/chairAlignment";

// CHAIR_TERM_TURNS lives in src/lib/turn/centralBankChairSelection.ts (not re-exported
// from @/lib/db/types/centralBank), so we keep the literal here to match it (4 years × 48 turns).
const TERM_TURNS = 192;

/**
 * Appoint an autonomous technocrat NPP as central-bank chair for a disabled/econ-only
 * country. Reuses an existing unseated centralBankChair technocrat for that country if
 * available; otherwise spawns a fresh one. Mutates the bank doc.
 */
export async function appointNppChair(
  db: Db,
  bank: CentralBank,
  countryId: CountryId,
  currentTurn: number
): Promise<void> {
  // A bank with a committee already HAS a chair: seat 0 of `fomcBoard`. Spawning
  // a second technocrat here made the central-bank page name one person while
  // the committee's motions were tabled by another, which is most of why players
  // read the chair as "randomly selected". Adopt the committee's chair instead.
  const boardChair = (bank.fomcBoard ?? []).find((seat) => seat.isChair) ?? bank.fomcBoard?.[0];
  if (boardChair && boardChair.occupantType === "npp" && boardChair.nppId) {
    const boardTerm = boardChair.termExpiresAtTurn;
    // Copying an already-expired board term left termExpired true forever, so
    // the selection phase re-appointed a technocrat every turn. Grant a fresh
    // term and stamp it on the committee seat so FOMC does not roll the chair
    // again next turn.
    const chairTermExpiresAtTurn =
      typeof boardTerm === "number" && boardTerm > currentTurn
        ? boardTerm
        : currentTurn + TERM_TURNS;
    const nextBoard = (bank.fomcBoard ?? []).map((seat) =>
      seat.isChair || seat.seatId === boardChair.seatId
        ? { ...seat, termExpiresAtTurn: chairTermExpiresAtTurn }
        : seat
    );
    await db.collection<CentralBank>("centralBanks").updateOne(
      { _id: bank._id },
      {
        $set: {
          chairMode: "npp",
          chairNppId: boardChair.nppId,
          chairCharacterId: null,
          chairCharacterName: null,
          chairAlignment: boardChair.alignment,
          chairTermExpiresAtTurn,
          fomcBoard: nextBoard,
          vacancyAwaitingAutomaticSelection: false,
          updatedAt: new Date(),
        },
        $unset: { nominations: "", lobbyingPool: "" },
      }
    );
    return;
  }

  const existing = await db.collection<NPP>("npps").findOne({
    countryId,
    isTechnocrat: true,
    technocratRole: "centralBankChair",
  });

  // Reuse the existing technocrat only if it is not already seated as chair on
  // another bank (I1). Under the current architecture appointment is per-bank
  // (shared banks like the ECB resolve to one doc) and a technocrat is
  // country-scoped, so this is defensive — but it guarantees we never
  // double-seat one NPP across two banks if a country ever gets a second bank.
  let chosenNpp: NPP;
  if (existing) {
    const seatedElsewhere = await db.collection<CentralBank>("centralBanks").findOne({
      _id: { $ne: bank._id },
      chairNppId: existing._id,
    });
    chosenNpp = seatedElsewhere
      ? await spawnTechnocratNpp(db, countryId, "centralBankChair")
      : existing;
  } else {
    chosenNpp = await spawnTechnocratNpp(db, countryId, "centralBankChair");
  }

  // Vary policy temperament across chairs: flip the outgoing chair's alignment so
  // hawk → dove → hawk over successive terms. Bootstrap (no prior alignment) from
  // the incoming technocrat's personality.
  const newAlignment: ChairAlignment = bank.chairAlignment
    ? oppositeAlignment(bank.chairAlignment)
    : chosenNpp.personality
      ? deriveChairAlignment(chosenNpp.personality)
      : "hawk";

  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bank._id },
    {
      $set: {
        chairMode: "npp",
        chairNppId: chosenNpp._id,
        chairCharacterId: null,
        chairCharacterName: null,
        chairAlignment: newAlignment,
        chairTermExpiresAtTurn: currentTurn + TERM_TURNS,
        vacancyAwaitingAutomaticSelection: false,
        updatedAt: new Date(),
      },
      $unset: { nominations: "", lobbyingPool: "" },
    }
  );
}
