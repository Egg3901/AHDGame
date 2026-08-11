import type { Db } from "mongodb";
import type { StatePartyOrg } from "@/lib/db/types";
import { getCnRegionOrg, getCnPartyTreasury } from "@/lib/seeds/cn/cnStatePartyOrgCalculations";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

/**
 * China state party organization seeder.
 *
 * China operates under a one-party dominant system. The Chinese Communist Party
 * (CCP) is the governing party with deep organizational presence across all
 * macro-regions. Minor parties (CDL, CNDCA) hold advisory roles within the
 * CPPCC framework and do NOT create a normal government alternation path.
 *
 * Party sequentialIds (based on seedOrder in cnParties.ts):
 *   CCP:   "1"  — Chinese Communist Party (governing)
 *   CDL:   "2"  — China Democratic League (advisory)
 *   CNDCA: "3"  — China National Democratic Construction Association (advisory)
 *
 * Per-region Reg / Org values (T3 calibration, 2026-05-23):
 *   - CCP is overwhelmingly dominant — Org and Reg both sit near 95 in every
 *     region. Capital and politically central regions slightly higher.
 *   - CDL (academic / educator base): strongest in HB (Beijing), HD
 *     (Shanghai / Jiangsu / Zhejiang universities), HZ (Hubei / Hunan
 *     universities), XN (Sichuan tradition).
 *   - CNDCA (industrialist / commercial base): strongest in HD (Shanghai
 *     is the founding home), HB (Beijing / Tianjin), HN (Guangdong
 *     commerce), DB (heavy industry heritage).
 *
 * `registration` mirrors `organization` per row — the swing-flow engine's
 * `regByParty` map is what gates §7.3.2 defense. Without seeded registration,
 * CCP would be 20%-peelable (newcomer baseline) under `transferableShare` /
 * `persuasionResistance`. The shared `seedRegistrationLanes` pipeline only
 * covers US / UK / JP / DE, so CN sets `registration` inline here.
 *
 * Era-specific org tables are in cnStatePartyOrgCalculations.ts. The 2019
 * table matches the previous hardcoded values verbatim. The 1991 table
 * reflects peak party-state dominance (CCP +2–3 per region, minor parties −1–2).
 */

const CN_REGION_IDS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];

interface CNPartyConfig {
  seqId: string;
  slug: "ccp" | "cdl" | "cndca";
  stateTaxRate: number;
}

const CN_PARTY_CONFIGS: CNPartyConfig[] = [
  { seqId: "1", slug: "ccp", stateTaxRate: 5 },
  { seqId: "2", slug: "cdl", stateTaxRate: 2 },
  { seqId: "3", slug: "cndca", stateTaxRate: 2 },
];

export async function seedCnStatePartyOrg(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset?: string
): Promise<void> {
  const activePreset = preset ?? (await getGameStatePresetOrDefault(db));

  if (reset) {
    await db.collection("statePartyOrg").deleteMany({ countryId: "CN" });
  }

  const regionOrg = getCnRegionOrg(activePreset);
  const treasury = getCnPartyTreasury(activePreset);
  const now = new Date();
  const orgs: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];

  for (const regionId of CN_REGION_IDS) {
    const orgRow = regionOrg[regionId];
    if (!orgRow) {
      throw new Error(`CN seed: missing regionOrg entry for region ${regionId}`);
    }

    for (const party of CN_PARTY_CONFIGS) {
      const orgValue =
        party.slug === "ccp" ? orgRow.ccp : party.slug === "cdl" ? orgRow.cdl : orgRow.cndca;
      const partyTreasury = treasury[party.slug];
      orgs.push({
        _id: `${regionId}_${party.seqId}`,
        countryId: "CN",
        stateId: regionId,
        partyId: party.seqId,
        organization: orgValue,
        registration: orgValue,
        chairId: null,
        viceChairId: null,
        treasurerId: null,
        treasury: partyTreasury,
        stateTaxRate: party.stateTaxRate,
        politicalStrength: 0,
        hasPresence: true,
        consecutiveLosses: 0,
      });
    }
  }

  let upserted = 0;
  for (const org of orgs) {
    const { _id, ...orgData } = org;
    const result = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id },
        { $set: { ...orgData, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
    if (result.upsertedCount > 0) upserted++;
  }

  log(
    `Seeded ${orgs.length} CN state party org entries (${upserted} new, ${orgs.length - upserted} updated) [preset: ${activePreset}]`
  );
}
