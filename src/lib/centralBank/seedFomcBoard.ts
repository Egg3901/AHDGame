import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CentralBank, FomcSeat } from "@/lib/db/types/centralBank";
import { FOMC_BOARD_SIZE, FOMC_TERM_TURNS } from "@/lib/db/types/centralBank";
import { spawnTechnocratNpp } from "@/lib/npp/generator";
import type { ChairAlignment } from "@/lib/centralBank/chairAlignment";
import { isBankGovernmentControlledLive } from "@/lib/centralBank/governance";

/**
 * Staggered term expiry so at most one seat opens per window: seat i of N
 * expires 1/N of a term sooner than seat i+1, spreading vacancies across the
 * whole 4-year term instead of opening the entire board at once.
 */
function staggeredExpiry(seatIndex: number, boardSize: number, startTurn: number): number {
  const span = Math.max(1, Math.round(((seatIndex + 1) * FOMC_TERM_TURNS) / boardSize));
  return startTurn + span;
}

/** Alternate hawk/dove across seats for a mixed committee. */
function seatAlignment(seatIndex: number): ChairAlignment {
  return seatIndex % 2 === 0 ? "hawk" : "dove";
}

/**
 * Populate an FOMC committee for every central bank that lacks one. Called at
 * iteration start (after `updateCentralBanks`). Each seat is a technocrat NPP
 * (role `fomcMember`); seat 0 is the chair and is mirrored onto the bank's
 * single-chair fields so existing chair consumers stay coherent. Idempotent:
 * banks already carrying a non-empty `fomcBoard` are skipped, so a re-run never
 * double-seats a board.
 */
export async function seedFomcBoards(
  db: Db,
  startTurn: number,
  log?: (msg: string) => void
): Promise<number> {
  const banks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  let seeded = 0;

  for (const bank of banks) {
    if (bank.fomcBoard && bank.fomcBoard.length > 0) continue;
    const countryId = bank.countryId as CountryId;

    // No committee for a bank the government controls: the MPC was CREATED by
    // the 1997 independence grant, so a pre-1997 Bank of England has no board.
    // Granting independence by law seeds the board then (see billEnactment).
    if (await isBankGovernmentControlledLive(bank, countryId)) continue;

    // A player already holding the chair keeps it: seat 0 adopts them rather
    // than spawning a technocrat over the top. Granting independence by law is
    // what creates the committee, and it must not be a backdoor eviction.
    const sittingChairId = bank.chairMode === "character" ? bank.chairCharacterId : null;

    const board: FomcSeat[] = [];
    for (let i = 0; i < FOMC_BOARD_SIZE; i++) {
      const alignment = seatAlignment(i);
      const termExpiresAtTurn = staggeredExpiry(i, FOMC_BOARD_SIZE, startTurn);
      if (i === 0 && sittingChairId) {
        board.push({
          seatId: "seat-1",
          isChair: true,
          occupantType: "player",
          characterId: sittingChairId,
          characterName: bank.chairCharacterName ?? "",
          nppId: null,
          alignment,
          appointedByPresidentId: bank.chairAppointedBy ?? null,
          appointedAtTurn: startTurn,
          // Keep the player's own term, not the staggered technocrat rotation.
          termExpiresAtTurn: bank.chairTermExpiresAtTurn ?? termExpiresAtTurn,
        });
        continue;
      }
      const npp = await spawnTechnocratNpp(db, countryId, "fomcMember");
      board.push({
        seatId: `seat-${i + 1}`,
        isChair: i === 0,
        occupantType: "npp",
        characterId: null,
        characterName: npp.name,
        nppId: npp._id,
        alignment,
        appointedByPresidentId: null,
        appointedAtTurn: startTurn,
        termExpiresAtTurn,
      });
    }

    const chair = board[0];
    await db.collection<CentralBank>("centralBanks").updateOne(
      { _id: bank._id },
      {
        $set: {
          fomcBoard: board,
          activeFomcMeeting: null,
          rateChangesThisTerm: 0,
          fomcTermStartedAtTurn: startTurn,
          // Mirror the chair onto the single-chair fields so legacy chair
          // consumers (display, infamy) resolve. The committee owns the rate.
          chairMode: chair.occupantType === "player" ? "character" : "npp",
          chairNppId: chair.nppId,
          chairAlignment: chair.alignment,
          chairTermExpiresAtTurn: chair.termExpiresAtTurn,
          updatedAt: new Date(),
        },
      }
    );
    seeded++;
  }

  log?.(`  ✓ FOMC committees seeded for ${seeded} bank(s)`);
  return seeded;
}
