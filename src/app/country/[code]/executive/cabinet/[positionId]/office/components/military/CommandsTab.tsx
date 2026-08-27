"use client";

import type { MilitaryCommand, CommanderRef, ThreatLevel } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictAssignment } from "@/lib/military/assignments";
import { CommandsBuilder } from "./commands/CommandsBuilder";
import { GeneralCorps } from "./GeneralCorps";
import type { CorpsMember } from "@/lib/db/collections/characterGenerals";

/**
 * Commands tab for the Secretary of Defense Office — the national command builder
 * (create commands, assign regions/commanders/forces), inline. Persistence and pure
 * logic live in the shared military state; this tab is the cabinet-styled home for it.
 */
export function CommandsTab({
  commands,
  units,
  commanders,
  conflictAssignments,
  conflicts,
  corps,
  commissionCandidates,
  regionThreats,
  countryCode,
  positionId,
}: {
  commands: MilitaryCommand[];
  units: MilitaryUnit[];
  commanders: CommanderRef[];
  conflictAssignments: ConflictAssignment[];
  /**
   * The live conflicts a general can be posted to. The builder's posting dropdown is
   * built from this, and an existing posting is NAMED by looking its theatre id up in
   * it — so an empty list is not a quiet degradation: the seat cannot send anyone to a
   * war at all, and the posting badge falls back to printing the raw id at the player.
   *
   * Required, unlike the same prop further down the tree. This tab is where the chain
   * broke: the builder below it defaults to an empty list, so the caller that forgot
   * to pass one type-checked cleanly and the seat simply lost the ability to post
   * anyone. Making it mandatory here turns that back into a compile error.
   */
  conflicts: { id: string; name: string }[];
  corps: CorpsMember[];
  commissionCandidates: { characterId: string; name: string }[];
  regionThreats: Record<string, ThreatLevel>;
  countryCode: string;
  positionId: string;
}) {
  return (
    <div className="space-y-4">
      <GeneralCorps
        corps={corps}
        candidates={commissionCandidates}
        countryCode={countryCode}
        positionId={positionId}
      />
      <CommandsBuilder
        commands={commands}
        units={units}
        commanders={commanders}
        conflictAssignments={conflictAssignments}
        conflicts={conflicts}
        regionThreats={regionThreats}
        countryCode={countryCode}
        positionId={positionId}
      />
    </div>
  );
}
