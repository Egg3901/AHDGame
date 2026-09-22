/**
 * What a player calls the thing they just built.
 *
 * Under `marketSystemMode >= "plants"` a sector is a set of physical sites you
 * buy capacity in. The engine calls every one of them a "plant" because the
 * mode, the fields and the migrations all needed ONE word. Players do not talk
 * that way: nobody opens a telecom plant or a retail plant. They open a network
 * hub and a store.
 *
 * So the engine keeps its word and the interface gets this one. Nothing here is
 * persisted, read by the turn, or allowed to change a number. It is display
 * copy keyed by sector type, in one place so the eighteen surfaces that say it
 * cannot drift into eighteen different words.
 *
 * COPY RULE (project standing): plain language, short, no dashes, no jargon.
 */

import type { CorporationType } from "@/lib/constants/corporations";

export interface FacilityVocabulary {
  /** "store". Lowercase; capitalize at the call site when it leads a sentence. */
  singular: string;
  /** "stores". */
  plural: string;
  /**
   * The verb for acquiring one. You BUILD a plant and OPEN a store, and a
   * button that says "Build a store" reads wrong to anyone who has ever run
   * one. Lowercase, same rule as the nouns.
   */
  buildVerb: "build" | "open" | "sink";
  /**
   * What the site does when it is running, for meters and idle copy: "the
   * line" is right for a factory and absurd for a bank branch.
   */
  runNoun: string;
}

/**
 * The generic used when a surface spans several sector types at once (the
 * corporation sectors table, the CEO summary, the national panel). "Facility"
 * is the one word that is never wrong, if never especially evocative.
 */
export const GENERIC_FACILITY: FacilityVocabulary = {
  singular: "facility",
  plural: "facilities",
  buildVerb: "build",
  runNoun: "the operation",
};

const VOCABULARY: Record<CorporationType, FacilityVocabulary> = {
  financial: { singular: "branch", plural: "branches", buildVerb: "open", runNoun: "the desk" },
  media: { singular: "newsroom", plural: "newsrooms", buildVerb: "open", runNoun: "the desk" },
  manufacturing: { singular: "plant", plural: "plants", buildVerb: "build", runNoun: "the line" },
  chemical_industries: {
    singular: "works",
    plural: "works",
    buildVerb: "build",
    runNoun: "the line",
  },
  healthcare: { singular: "clinic", plural: "clinics", buildVerb: "open", runNoun: "the ward" },
  retail: { singular: "store", plural: "stores", buildVerb: "open", runNoun: "the floor" },
  automobiles: {
    singular: "assembly plant",
    plural: "assembly plants",
    buildVerb: "build",
    runNoun: "the line",
  },
  technology: { singular: "campus", plural: "campuses", buildVerb: "build", runNoun: "the floor" },
  energy: {
    singular: "power station",
    plural: "power stations",
    buildVerb: "build",
    runNoun: "the grid feed",
  },
  agriculture: { singular: "farm", plural: "farms", buildVerb: "build", runNoun: "the fields" },
  real_estate: {
    singular: "development",
    plural: "developments",
    buildVerb: "build",
    runNoun: "the site",
  },
  construction: { singular: "yard", plural: "yards", buildVerb: "open", runNoun: "the crews" },
  defense: { singular: "arsenal", plural: "arsenals", buildVerb: "build", runNoun: "the line" },
  telecommunications: {
    singular: "network hub",
    plural: "network hubs",
    buildVerb: "build",
    runNoun: "the network",
  },
  entertainment: { singular: "venue", plural: "venues", buildVerb: "open", runNoun: "the room" },
  logistics: { singular: "depot", plural: "depots", buildVerb: "open", runNoun: "the fleet" },
  extraction: { singular: "mine", plural: "mines", buildVerb: "sink", runNoun: "the workings" },
};

/**
 * Vocabulary for a sector type. Unknown or missing types fall back to the
 * generic rather than throwing: this is copy, and a sector carrying a stale
 * type from a pre-rename world should render "facility", not a broken page.
 */
export function facilityVocabulary(
  sectorType: CorporationType | string | null | undefined
): FacilityVocabulary {
  if (!sectorType) return GENERIC_FACILITY;
  return VOCABULARY[sectorType as CorporationType] ?? GENERIC_FACILITY;
}

/** "store" / "facility". */
export function facilitySingular(sectorType: CorporationType | string | null | undefined): string {
  return facilityVocabulary(sectorType).singular;
}

/** "stores" / "facilities". */
export function facilityPlural(sectorType: CorporationType | string | null | undefined): string {
  return facilityVocabulary(sectorType).plural;
}

/** Sentence-leading form: "Stores", "Network hubs". */
export function capitalizeFacility(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "open a store", "build an arsenal", "sink a mine". Handles a/an. */
export function buildOnePhrase(sectorType: CorporationType | string | null | undefined): string {
  const v = facilityVocabulary(sectorType);
  const article = /^[aeiou]/i.test(v.singular) ? "an" : "a";
  // "works" is already plural in form, so it takes no article.
  if (v.singular === v.plural) return `${v.buildVerb} more ${v.singular}`;
  return `${v.buildVerb} ${article} ${v.singular}`;
}

/** "Your stores", "Your network hubs". */
export function yourFacilities(sectorType: CorporationType | string | null | undefined): string {
  return `Your ${facilityPlural(sectorType)}`;
}
