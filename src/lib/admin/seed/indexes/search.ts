import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

// Indexes powering /api/search/universal.
// Each searchable collection gets a compound text index covering its
// primary match fields — the route currently uses regex, but these indexes
// keep future $text migration one switch away and already speed up queries
// that can anchor on the collection-scoped filters (countryId, status).
export async function seedSearchIndexes(db: Db, log: (msg: string) => void) {
  log("Search indexes:");

  await ensureIndex(
    db,
    "characters",
    { name: "text", party: "text", homeState: "text" },
    { name: "characters_text_search", background: true },
    log
  );

  await ensureIndex(
    db,
    "npps",
    { name: "text", party: "text", homeState: "text" },
    { name: "npps_text_search", background: true },
    log
  );
  await ensureIndex(
    db,
    "npps",
    { retiredAt: 1 },
    { name: "npps_retiredAt", background: true },
    log
  );

  await ensureIndex(
    db,
    "electedOfficials",
    { state: "text", officeType: "text" },
    { name: "electedOfficials_text_search", background: true },
    log
  );

  await ensureIndex(
    db,
    "elections",
    { state: "text", electionType: "text" },
    { name: "elections_text_search", background: true },
    log
  );
  await ensureIndex(
    db,
    "elections",
    { status: 1, countryId: 1 },
    { name: "elections_status_countryId", background: true },
    log
  );

  await ensureIndex(
    db,
    "corporations",
    { name: "text", description: "text" },
    { name: "corporations_text_search", background: true },
    log
  );

  await ensureIndex(
    db,
    "legislation",
    { title: "text", summary: "text", sponsorName: "text" },
    { name: "legislation_text_search", background: true },
    log
  );

  await ensureIndex(
    db,
    "stateBills",
    { title: "text", summary: "text", sponsorName: "text" },
    { name: "stateBills_text_search", background: true },
    log
  );

  await ensureIndex(
    db,
    "wikiPages",
    { title: "text", description: "text", content: "text" },
    { name: "wikiPages_text_search", background: true },
    log
  );
  await ensureIndex(
    db,
    "wikiPages",
    { status: 1, private: 1 },
    { name: "wikiPages_status_private", background: true },
    log
  );

  log("Search indexes ensured");
}
