import type { Db } from "mongodb";
import type { StatePartyOrg } from "@/lib/db/types";
import { getDdRegionOrg, getDdPartyTreasury } from "@/lib/seeds/dd/ddStatePartyOrgCalculations";
import { getGameStatePreset } from "@/lib/db/collections/gameState";

/**
 * East Germany state party organization seeder.
 *
 * The GDR is a one-party state behind the National Front facade — the SED
 * governs, and the four bloc parties (CDU-Ost, LDPD, NDPD, DBD) hold captive
 * seats without a government-alternation path (the CN advisory-party model,
 * not the RU single-party model).
 *
 * Party sequentialIds (based on seedOrder in ddParties.ts):
 *   SED:  "1" — Sozialistische Einheitspartei Deutschlands (governing)
 *   CDU:  "2" — Christlich-Demokratische Union (Ost)
 *   LDPD: "3" — Liberal-Demokratische Partei Deutschlands
 *   NDPD: "4" — National-Demokratische Partei Deutschlands
 *   DBD:  "5" — Demokratische Bauernpartei Deutschlands
 *
 * `registration` mirrors `organization` per row — the swing-flow engine's
 * `regByParty` map is what gates §7.3.2 defense. Without seeded registration,
 * the SED would be 20%-peelable (newcomer baseline) under `transferableShare`
 * / `persuasionResistance`. The shared `seedRegistrationLanes` pipeline only
 * covers US / UK / JP / DE, so DD sets `registration` inline here (the RU/CN
 * precedent).
 *
 * Era-specific org tables live in ddStatePartyOrgCalculations.ts — both
 * Cold-War presets seed the same six eastern-Länder codes.
 */

const DD_REGION_IDS = ["BEO", "MV", "BB", "ST", "SN", "TH"];

interface DdPartyConfig {
  seqId: string;
  slug: "sed" | "cdu" | "ldpd" | "ndpd" | "dbd";
  stateTaxRate: number;
}

const DD_PARTY_CONFIGS: DdPartyConfig[] = [
  { seqId: "1", slug: "sed", stateTaxRate: 5 },
  { seqId: "2", slug: "cdu", stateTaxRate: 2 },
  { seqId: "3", slug: "ldpd", stateTaxRate: 2 },
  { seqId: "4", slug: "ndpd", stateTaxRate: 2 },
  { seqId: "5", slug: "dbd", stateTaxRate: 2 },
];

export async function seedDdStatePartyOrg(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset?: string
): Promise<void> {
  const activePreset = preset ?? (await getGameStatePreset(db)) ?? "1953-default";

  // The GDR only exists in the divided-Germany (1953/1979) eras — its Länder
  // belong to DE in unified eras, so seeding here would attach National Front
  // rosters to West German states (the RU-regions gate, refs #3269).
  const { isEasternBlocEra } = await import("@/lib/seeds/presetSelector");
  if (!isEasternBlocEra(activePreset)) {
    log(
      `Skipping DD state party org seed — the GDR only exists in divided eras (preset ${activePreset})`
    );
    return;
  }

  if (reset) {
    await db.collection("statePartyOrg").deleteMany({ countryId: "DD" });
  }

  const regionOrg = getDdRegionOrg(activePreset);
  const treasury = getDdPartyTreasury(activePreset);
  const now = new Date();
  const orgs: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];

  for (const regionId of DD_REGION_IDS) {
    const orgRow = regionOrg[regionId];
    if (!orgRow) {
      throw new Error(`DD seed: missing regionOrg entry for region ${regionId}`);
    }

    for (const party of DD_PARTY_CONFIGS) {
      orgs.push({
        _id: `${regionId}_${party.seqId}`,
        countryId: "DD",
        stateId: regionId,
        partyId: party.seqId,
        organization: orgRow[party.slug],
        registration: orgRow[party.slug],
        chairId: null,
        viceChairId: null,
        treasurerId: null,
        treasury: treasury[party.slug],
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
    `Seeded ${orgs.length} DD state party org entries (${upserted} new, ${orgs.length - upserted} updated) [preset: ${activePreset}]`
  );
}
