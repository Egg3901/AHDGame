/**
 * Archetype Approval Decay
 *
 * Decays all character and NPP archetype approvals by 0.5% per turn toward 0.
 * This creates a natural half-life where approval effects fade over time,
 * requiring ongoing action to maintain relationships with voter archetypes.
 *
 * Decay rate: 0.5% per turn = ~22% decay per game year (48 turns)
 */

import { getDb } from "@/lib/mongodb";
import type { Character, NPP } from "@/lib/db/types";

/** Decay rate per turn: 0.5% = 0.005 */
const DECAY_RATE = 0.005;

/** Minimum absolute value below which approval is zeroed out */
const ZERO_THRESHOLD = 0.01;

/**
 * Apply decay to a single archetype approvals record.
 * Each value decays 0.5% toward 0 per turn.
 *
 * @returns Updated approvals record, or null if no changes needed
 */
function decayApprovals(
  approvals: Record<string, number> | undefined
): Record<string, number> | null {
  if (!approvals || Object.keys(approvals).length === 0) return null;

  const decayed: Record<string, number> = {};
  let hasChanges = false;

  for (const [archetypeId, value] of Object.entries(approvals)) {
    if (value === 0) {
      decayed[archetypeId] = 0;
      continue;
    }

    // Decay toward 0: multiply by (1 - DECAY_RATE)
    // Positive values decrease, negative values increase toward 0
    const newValue = value * (1 - DECAY_RATE);

    // Zero out values below threshold
    if (Math.abs(newValue) < ZERO_THRESHOLD) {
      decayed[archetypeId] = 0;
    } else {
      decayed[archetypeId] = Math.round(newValue * 100) / 100; // Round to 2 decimal places
    }

    if (decayed[archetypeId] !== value) {
      hasChanges = true;
    }
  }

  return hasChanges ? decayed : null;
}

/**
 * Process archetype approval decay for all characters and NPPs.
 * Called once per turn during turn processing.
 *
 * @returns Summary of characters and NPPs processed
 */
export async function processArchetypeApprovalDecay(): Promise<{
  charactersProcessed: number;
  nppsProcessed: number;
}> {
  const db = await getDb();

  // Process characters with archetype approvals
  const characters = await db
    .collection<Character>("characters")
    .find({ archetypeApprovals: { $exists: true, $ne: {} } })
    .toArray();

  const charOps: {
    updateOne: {
      filter: { _id: (typeof characters)[number]["_id"] };
      update: { $set: { archetypeApprovals: Record<string, number> } };
    };
  }[] = [];
  for (const character of characters) {
    const decayed = decayApprovals(character.archetypeApprovals);
    if (decayed) {
      charOps.push({
        updateOne: {
          filter: { _id: character._id },
          update: { $set: { archetypeApprovals: decayed } },
        },
      });
    }
  }
  if (charOps.length > 0) {
    await db.collection<Character>("characters").bulkWrite(charOps);
  }
  const charactersProcessed = charOps.length;

  // Process NPPs with archetype approvals
  const npps = await db
    .collection<NPP>("npps")
    // `policies` is ~94% of an NPP document (~30KB of ~31KB) and is not read
    // here. Turn CPU is 30% BSON deserialization; not fetching what nothing
    // reads is the cheapest lever on it.
    .find(
      { archetypeApprovals: { $exists: true, $ne: {} }, retiredAt: null },
      { projection: { policies: 0 } }
    )
    .toArray();

  const nppOps: {
    updateOne: {
      filter: { _id: (typeof npps)[number]["_id"] };
      update: { $set: { archetypeApprovals: Record<string, number> } };
    };
  }[] = [];
  for (const npp of npps) {
    const decayed = decayApprovals(npp.archetypeApprovals);
    if (decayed) {
      nppOps.push({
        updateOne: {
          filter: { _id: npp._id },
          update: { $set: { archetypeApprovals: decayed } },
        },
      });
    }
  }
  if (nppOps.length > 0) {
    await db.collection<NPP>("npps").bulkWrite(nppOps);
  }
  const nppsProcessed = nppOps.length;

  return { charactersProcessed, nppsProcessed };
}
