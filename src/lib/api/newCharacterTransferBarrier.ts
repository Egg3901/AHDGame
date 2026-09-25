import { NextResponse } from "next/server";
import { getGameTime } from "@/lib/time/gameTime";
import {
  getNewCharacterTransferBarrier,
  NEW_CHARACTER_TRANSFER_BARRIER_TURNS,
  type NewCharacterTransferBarrierInput,
} from "@/lib/character/newCharacterTransferBarrier";

/**
 * 403 response while the character is inside its post-creation transfer
 * barrier, else null.
 *
 * The barrier exists because a peer trade at a skewed price is a disguised
 * transfer: it is enforced on transfers, wires, and both ends of direct forex.
 * Every other player-to-player value channel — limit-order place AND fill,
 * share offers, order fills — is the same surface and gets the same gate. The
 * requester's character is checked regardless of whether money moves through
 * their personal wallet or a corporation they control: a fresh account's corp
 * can only hold what the account put in.
 */
export async function newCharacterTransferBarrierResponse(
  character: NewCharacterTransferBarrierInput
): Promise<NextResponse | null> {
  const gameTime = await getGameTime();
  const barrier = getNewCharacterTransferBarrier(
    character,
    gameTime.currentTurn,
    gameTime.effectiveNow.getTime()
  );
  if (!barrier.blocked) return null;
  return NextResponse.json(
    {
      error: `New characters cannot send funds for their first ${NEW_CHARACTER_TRANSFER_BARRIER_TURNS} turns. You can send in ${barrier.remainingTurns} turn(s).`,
      remainingTurns: barrier.remainingTurns,
    },
    { status: 403 }
  );
}
