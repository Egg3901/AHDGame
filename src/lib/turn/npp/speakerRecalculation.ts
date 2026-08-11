// src/lib/turn/npp/speakerRecalculation.ts
/**
 * NPP Speaker Vote Recalculation
 *
 * Kept as a compatibility shim now that US congressional leadership elections
 * are player-only. The API no longer asks NPPs to recalculate Speaker votes.
 */

export async function recalculateNPPSpeakerVotes(): Promise<void> {
  // Intentionally empty: congressional leadership no longer accepts NPP votes.
}
