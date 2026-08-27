/**
 * Who is at this war, on which side, and what put them there.
 *
 * Pure, and deliberately: the attacker/defender rule is a judgment about a war,
 * and every clause of it should be pinnable without a database.
 *
 * WHY THE HOST DECIDES WHO ATTACKED. A conflict document does not record an
 * aggressor. `declareWar` happens to build side A from the declarer and side B
 * from the defender plus its allies, but seeded and admin-created conflicts do
 * not follow that, and a roster can change afterwards — so reading side A as
 * "the attackers" would be an assumption dressed as a fact. Host membership is
 * the same test `initialControl` already uses to decide whose soil the war opens
 * on, and it survives both: the side standing on the other's ground attacked it.
 *
 * A host that fights on NEITHER side is every proxy war, and there the question
 * has no answer in the data. Naming an aggressor there would be inventing one,
 * so both sides simply keep their own labels.
 */
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { entityName } from "@/lib/constants/entityDisplay";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";

export interface BelligerentEntry {
  code: string;
  name: string;
  entry: string;
  viaTreaty?: boolean;
}

export interface BelligerentRollSide {
  heading: string;
  label: string;
  rows: BelligerentEntry[];
  faction?: string;
}

export interface BelligerentRoll {
  a: BelligerentRollSide;
  b: BelligerentRollSide;
}

type RollInput = Pick<ConflictDoc, "hostCountry" | "sideA" | "sideB"> &
  Partial<Pick<ConflictDoc, "treatyEntries" | "joinTurns">>;

/** Which roster holds the host, or null when it fights on neither. */
function hostSideOf(c: RollInput): "A" | "B" | null {
  if ((c.sideA?.countries as string[] | undefined)?.includes(c.hostCountry)) return "A";
  if ((c.sideB?.countries as string[] | undefined)?.includes(c.hostCountry)) return "B";
  return null;
}

/** The alliance's readable name, so a row says "Warsaw Pact" and not "WARSAW_PACT". */
function orgName(organizationId: string): string {
  return (
    INTERNATIONAL_ORGANIZATIONS[organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS]
      ?.shortName ??
    INTERNATIONAL_ORGANIZATIONS[organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS]?.name ??
    organizationId
  );
}

/**
 * What put ONE country at this war.
 *
 * Ordered most specific first. A treaty entry beats everything: it is the only
 * one of these that says the country did not choose to be here, and it is the
 * fact the whole panel exists to surface.
 */
function entryFor(
  c: RollInput,
  countryId: string,
  side: "A" | "B",
  hostSide: "A" | "B" | null
): BelligerentEntry {
  const base = { code: countryId, name: entityName(countryId) };

  const treaty = (c.treatyEntries ?? []).find((e) => e.countryId === countryId);
  if (treaty) return { ...base, entry: orgName(treaty.organizationId), viaTreaty: true };

  // "home ground", not "declared on": this country's own soil is the theatre, which
  // is true however the war started. The parallel wording would be a claim about a
  // declaration, and a seeded conflict never had one.
  if (countryId === c.hostCountry) return { ...base, entry: "home ground" };

  const joined = (c.joinTurns ?? []).find((j) => j.countryId === countryId);
  if (joined) return { ...base, entry: `joined T${joined.turn}` };

  // A founding belligerent. Which of the two it is depends on whose soil this is;
  // with no host on either roster there is no such distinction to draw.
  if (hostSide === null) return { ...base, entry: "belligerent" };
  return { ...base, entry: side === hostSide ? "declared on" : "declared" };
}

/**
 * What to call a side in a war fought over somebody else's ground.
 *
 * ATTACKERS and DEFENDERS have no meaning here — nobody is standing on their own
 * soil — but "both sides intervened" is not the interesting fact either. What a
 * proxy war is ABOUT is which local faction each great power is propping up, so
 * that is the heading: BACKING SOUTH VIETNAM against BACKING NORTH VIETNAM.
 *
 * A side with no faction falls back to INTERVENERS. That is the honest answer
 * rather than borrowing the other side's faction and negating it: a roster can
 * intervene in a proxy war without any faction of its own.
 */
function proxyHeading(faction: string | undefined): string {
  return faction ? `BACKING ${entityName(faction).toUpperCase()}` : "INTERVENERS";
}

export function belligerentRoll(c: RollInput): BelligerentRoll {
  const hostSide = hostSideOf(c);
  const build = (side: "A" | "B"): BelligerentRollSide => {
    const roster = ((side === "A" ? c.sideA?.countries : c.sideB?.countries) ?? []) as string[];
    const label = (side === "A" ? c.sideA?.label : c.sideB?.label) ?? "";
    const faction = side === "A" ? c.sideA?.factionEntity : c.sideB?.factionEntity;
    const heading =
      hostSide === null ? proxyHeading(faction) : side === hostSide ? "DEFENDERS" : "ATTACKERS";
    return {
      heading,
      label,
      rows: roster.map((countryId) => entryFor(c, countryId, side, hostSide)),
      ...(faction ? { faction: entityName(faction) } : {}),
    };
  };
  return { a: build("A"), b: build("B") };
}
