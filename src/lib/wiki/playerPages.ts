import type { CountryId } from "@/lib/constants/countries";

/**
 * Deterministic wiki slugs for player- and corporation-owned pages.
 *
 * Slugs key off public sequential IDs (the same numeric IDs used in
 * `/character/123`, `/corporation/152`, `/parties/1?country=us`) so URLs
 * stay short and human-friendly. We never expose a Mongo ObjectId in a
 * wiki slug.
 *
 * Party `sequentialId` is unique only within a country, so the party slug
 * includes the country code.
 */

export function playerWikiSlug(sequentialId: number): string {
  return `player-${sequentialId}`;
}

export function corporationWikiSlug(sequentialId: number): string {
  return `corp-${sequentialId}`;
}

export function partyWikiSlug(countryId: CountryId, sequentialId: number): string {
  return `party-${countryId.toLowerCase()}-${sequentialId}`;
}

/** Initial markdown stub a player gets when they start a fresh page. */
export function playerWikiStarter(characterName: string): string {
  const safeName = characterName.replace(/[\r\n]+/g, " ").trim() || "this politician";
  return [
    `# ${safeName}`,
    "",
    "_Write your biography here. This page is maintained by the player — admins may moderate it._",
    "",
    "## Background",
    "",
    "Describe where you grew up, your formative years, and the experiences that shaped your political views.",
    "",
    "## Political career",
    "",
    "- Early offices, campaigns, and notable votes.",
    "- Major legislation you championed.",
    "",
    "## Positions",
    "",
    "Summarize the issues you care most about.",
    "",
    "## Gallery",
    "",
    "Use the **Image** button in the toolbar to upload photos.",
    "",
  ].join("\n");
}

export function partyWikiStarter(partyName: string): string {
  const safeName = partyName.replace(/[\r\n]+/g, " ").trim() || "this party";
  return [
    `# ${safeName}`,
    "",
    "_Party-maintained profile page. Chair, vice-chair, and treasurer may edit._",
    "",
    "## Platform",
    "",
    "Core ideology and the policies we campaign on.",
    "",
    "## History",
    "",
    "Founding, notable victories, splits, and realignments.",
    "",
    "## Leadership",
    "",
    "Current officers and recent chair history.",
    "",
    "## Elected officials",
    "",
    "Notable members in legislative or executive office.",
    "",
  ].join("\n");
}

export function corporationWikiStarter(corporationName: string): string {
  const safeName = corporationName.replace(/[\r\n]+/g, " ").trim() || "this corporation";
  return [
    `# ${safeName}`,
    "",
    "_Company-maintained page. The CEO is responsible for its contents._",
    "",
    "## About",
    "",
    "Who we are, what we make, and who we serve.",
    "",
    "## History",
    "",
    "Key milestones, leadership changes, and historic turns.",
    "",
    "## Operations",
    "",
    "Sectors, flagship products, and strategic priorities.",
    "",
    "## Press",
    "",
    "Link to in-game news articles and major announcements.",
    "",
  ].join("\n");
}
