/** Historical re-entry rows share one filed person and retain their cast marks. */
export interface HuModernCampaignActor {
  id: string;
  ownerId: string;
  partyId: string;
  regionId: string;
  isNpc: boolean;
  status: string;
  filingOrder: number;
  votes: number;
}
export function coalesceHuModernCampaignActors(input: readonly HuModernCampaignActor[]): {
  actors: HuModernCampaignActor[];
  aliases: Record<string, string>;
} {
  if (
    new Set(input.map((row) => row.id)).size !== input.length ||
    input.some(
      (row) =>
        !row.id ||
        !row.ownerId ||
        !row.partyId ||
        !row.regionId ||
        !Number.isSafeInteger(row.filingOrder) ||
        row.filingOrder < 0 ||
        !Number.isSafeInteger(row.votes) ||
        row.votes < 0
    )
  )
    throw new Error("Invalid Hungarian modern campaign actor");
  const groups = new Map<string, HuModernCampaignActor[]>();
  for (const row of input) {
    const key = row.isNpc ? `npc:${row.ownerId}:${row.regionId}` : `player:${row.ownerId}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const actors: HuModernCampaignActor[] = [];
  const aliases: Record<string, string> = {};
  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        a.filingOrder - b.filingOrder ||
        a.id.localeCompare(b.id)
    );
    const original = ordered[0];
    if (
      ordered.some(
        (row) =>
          row.votes > 0 && (row.partyId !== original.partyId || row.regionId !== original.regionId)
      )
    )
      throw new Error("Hungarian re-entry cannot move cast votes between parties or regions");
    const votes = ordered.reduce((sum, row) => sum + row.votes, 0);
    if (!Number.isSafeInteger(votes)) throw new Error("Hungarian campaign vote sum is unsafe");
    actors.push({ ...original, votes });
    for (const row of ordered) if (row.id !== original.id) aliases[row.id] = original.id;
  }
  return { actors: actors.sort((a, b) => a.id.localeCompare(b.id)), aliases };
}
