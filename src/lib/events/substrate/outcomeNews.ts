import type { Db } from "mongodb";
import type { EventInstance, OutcomeTier } from "@/lib/db/types/events";
import type { Character } from "@/lib/db/types/character";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { createSystemNewsPost } from "@/lib/news";

function interpolate(
  text: string,
  vars: { name: string; corp: string; country: string; leader: string; sector: string }
): string {
  return text
    .replaceAll("{name}", vars.name)
    .replaceAll("{corp}", vars.corp)
    .replaceAll("{country}", vars.country)
    .replaceAll("{leader}", vars.leader)
    .replaceAll("{sector}", vars.sector);
}

/**
 * Emits a National Wire Service post for an outcome tier that carries a
 * `newsWire` payload. No-op for tiers without one (the common case), so only
 * the deliberately-tagged notable outcomes ever reach the public feed.
 *
 * Best-effort: a wire failure must never break event resolution, so the caller
 * wraps this in a try/catch.
 */
export async function emitOutcomeNewsWire(
  db: Db,
  instance: EventInstance,
  tier: OutcomeTier
): Promise<void> {
  const wire = tier.newsWire;
  if (!wire) return;

  let name = "A public figure";
  let country = "";
  let leader = "the government";
  if (instance.scope === "character") {
    const char = await db
      .collection<Character>("characters")
      .findOne({ _id: instance.scopeId }, { projection: { name: 1, countryId: 1 } });
    if (char) {
      name = char.name;
      const cfg = char.countryId ? COUNTRY_CONFIGS[char.countryId as CountryId] : undefined;
      country = cfg?.name ?? char.countryId ?? "";
    }
  } else if (instance.scope === "country") {
    const countryId = instance.payload.countryId as CountryId | undefined;
    if (countryId) {
      const cfg = COUNTRY_CONFIGS[countryId];
      country = cfg?.name ?? countryId;
      const leaderCharId = await getHeadOfGovernmentCharacterId(db, countryId);
      if (leaderCharId) {
        const leaderChar = await db
          .collection<Character>("characters")
          .findOne({ _id: leaderCharId }, { projection: { name: 1 } });
        if (leaderChar) leader = leaderChar.name;
      }
    }
  }

  const corp =
    (instance.payload.corpName as string) ??
    (instance.payload.corporationName as string) ??
    "their company";
  const sector = (instance.payload.sectorType as string) ?? "";

  const vars = { name, corp, country, leader, sector };
  await createSystemNewsPost(interpolate(wire.template, vars), wire.category, {
    title: interpolate(wire.title, vars),
  });
}
