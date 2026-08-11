#!/usr/bin/env node
/**
 * Rebuild the NPP politician portrait pool from Wikidata + Wikimedia Commons.
 *
 *   node scripts/build-npp-portraits.mjs            # every country, merged into the data file
 *   node scripts/build-npp-portraits.mjs FR IT      # only these
 *   node scripts/build-npp-portraits.mjs --dry-run  # print the summary, write nothing
 *
 * ── Why the filter is this strict ────────────────────────────────────────────
 *
 * The pool puts a real person's photograph on a fictional NPP, so "politicians
 * of country X" is the wrong query — it returns athletes, actors, spouses of
 * leaders, foreign nationals, coup leaders and party leaders of extremist
 * parties. A face like that on a randomly generated backbencher is the whole
 * risk. What we want is the anonymous middle of a legislature. So a portrait
 * is kept only when the person:
 *
 *   1. was born 1930 or later — removes the interwar and wartime political
 *      classes outright (anyone born after 1930 was a child in 1945);
 *   2. actually sat in that country's national legislature (holds a position
 *      that is a subclass of "member of parliament" scoped to the country) —
 *      removes athletes, entertainers, activists, spouses and foreigners who
 *      merely carry the "politician" occupation;
 *   3. is not famous — appears in at most MAX_SITELINKS Wikipedia language
 *      editions, which is what actually separates a backbencher from a public
 *      figure with a public record, and is neither a celebrity legislator nor
 *      a career military officer (occupation filter);
 *   4. never led a country or a party — no head of state, head of government,
 *      deputy leader, party chair or general secretary role in their history.
 *      Rank-and-file legislators are both less recognisable and far less
 *      likely to carry infamy than the people who ran things;
 *   5. has no conviction recorded (Wikidata P1399), which takes out coup
 *      leaders, war criminals and corruption cases in one filter;
 *   6. never belonged to a party in BLOCKED_PARTIES — neo-nazi and neo-fascist
 *      parties, and parties a court has ruled a criminal organisation;
 *   7. is not caught by BLOCKED_NAME_PATTERNS, the manual backstop;
 *   8. has a free-licensed Commons portrait that still resolves today.
 *
 * East Germany, Scotland and Wales get no pool of their own — see
 * PORTRAIT_COUNTRY_ALIASES in src/lib/npp/generator.ts. DD deliberately
 * borrows the modern German pool rather than photographing the SED leadership.
 *
 * ── Why it is shaped as several small queries ───────────────────────────────────
 *
 * WDQS answers 504 for anything unbound that walks a P279* chain or does a
 * reverse lookup. Every query below is either trivially selective or bound by
 * a VALUES list, and all the judgement happens locally in JS, where it is
 * reviewable.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "src", "data", "npp-politician-images.json");

const USER_AGENT = "AHD-NPP-Portraits/1.0 (https://ahousedividedgame.com)";
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/** Portraits to gather per country, and how many of them should be women. */
const TARGET_PER_COUNTRY = 60;
const TARGET_FEMALE = 20;

/**
 * Caps on how many Wikipedia language editions a person may appear in, tried
 * in order until a country fills its quota.
 *
 * This is the filter that does the most work. Property-based rules cannot
 * enumerate everyone a player might object to seeing on a random NPP — the
 * sanctioned provincial party secretary, the oligarch, the MP known for one
 * ugly remark. What those people have in common is that they are *famous*.
 * An ordinary backbencher has an article in two or three languages; anyone
 * with more than a handful is a public figure with a public record, which is
 * exactly what we do not want borrowed for a fictional politician.
 *
 * The cap is relaxed a step at a time rather than fixed, because countries
 * whose legislators are thinly covered on Wikidata — Nigeria's women MPs are
 * the worst case — would otherwise return a pool too small and too male to
 * ever match a generated NPP.
 */
const SITELINK_CAPS = [7, 12, 25];

/**
 * Wikidata country QIDs, with the NPPEthnicity tag their portraits carry.
 *
 * The tag only drives `selectPoliticianImage`'s exact-match tier — its
 * fallback chain (country+gender, then country) means a country whose real
 * political class is more mixed than one label can express still renders a
 * face. ETHNICITY_WEIGHTS in generator.ts is kept in step with these tags.
 */
const COUNTRIES = {
  US: { qid: "Q30", ethnicity: null }, // hand-curated; skipped unless named explicitly
  UK: { qid: "Q145", ethnicity: null }, // hand-curated; skipped unless named explicitly
  DE: { qid: "Q183", ethnicity: "white" },
  FR: { qid: "Q142", ethnicity: "white" },
  IT: { qid: "Q38", ethnicity: "white" },
  ES: { qid: "Q29", ethnicity: "white" },
  SE: { qid: "Q34", ethnicity: "white" },
  TR: { qid: "Q43", ethnicity: "white" },
  RU: { qid: "Q159", ethnicity: "white" },
  IE: { qid: "Q27", ethnicity: "white" },
  AT: { qid: "Q40", ethnicity: "white" },
  GR: { qid: "Q41", ethnicity: "white" },
  FI: { qid: "Q33", ethnicity: "white" },
  JP: { qid: "Q17", ethnicity: "asian" },
  CN: { qid: "Q148", ethnicity: "asian" },
  NG: { qid: "Q1033", ethnicity: "black" },
  BR: { qid: "Q155", ethnicity: "hispanic" },
};

/** Pools curated by hand that a full run must not overwrite. */
const HAND_CURATED = new Set(["US", "UK"]);

const MALE_QID = "Q6581097";
const FEMALE_QID = "Q6581072";

/**
 * Parties whose members are excluded regardless of conviction status.
 * Deliberately limited to neo-nazi / neo-fascist parties and parties ruled
 * criminal organisations by a court — not to any party on the political right.
 */
const BLOCKED_PARTIES = new Set([
  "Q7320", // NSDAP
  "Q193563", // National Fascist Party (IT)
  "Q612632", // Italian Social Movement
  "Q214536", // Golden Dawn (GR) — ruled a criminal organisation, 2020
  "Q157699", // NPD (DE)
  "Q207237", // Falange (ES)
  "Q1387659", // Die Republikaner (DE)
  "Q48884", // British National Party
]);

/**
 * Position labels that mean "this person led something". Matched against the
 * English label of every position the person has ever held.
 */
const LEADERSHIP_POSITION = new RegExp(
  [
    "^president\\b",
    "^vice[- ]president\\b",
    "^prime minister\\b",
    "^deputy prime minister\\b",
    "^(federal )?chancellor\\b",
    "^premier\\b",
    "^taoiseach$",
    "^t[áa]naiste$",
    "^head of (state|government)\\b",
    "^(paramount|supreme) leader\\b",
    "\\bleader of\\b",
    "\\bparty leader\\b",
    "\\bparty chair",
    "\\bchairman of\\b",
    "\\bchairperson of\\b",
    "\\bchairwoman of\\b",
    "\\b(general secretary|secretary[- ]general|first secretary)\\b",
    "^(king|queen|emperor|monarch|grand duke)\\b",
    "^governor\\b",
    "^governor[- ]general\\b",
    "^mayor of\\b",
    "^f[üu]hrer\\b",
    "^duce\\b",
    "^caudillo\\b",
  ].join("|"),
  "i"
);

/**
 * Occupations that disqualify a portrait even when the person genuinely sat in
 * the legislature. Celebrity legislators — the footballer, the pop singer, the
 * cosmonaut — are recognisable in exactly the way a background NPP must not be,
 * and military ranks pull in the coup-era officer class the birth-year filter
 * misses. Lawyer, teacher, economist and journalist stay: that is just what
 * legislators were before they were legislators.
 */
const BLOCKED_OCCUPATION = new RegExp(
  [
    "athlete",
    "sportsperson",
    "\\bplayer\\b",
    "footballer",
    "olympic",
    "boxer",
    "wrestler",
    "skier",
    "swimmer",
    "cyclist",
    "gymnast",
    "racing driver",
    "actor",
    "actress",
    "singer",
    "musician",
    "rapper",
    "comedian",
    "television presenter",
    "^model$",
    "film director",
    "astronaut",
    "cosmonaut",
    "military officer",
    "army officer",
    "naval officer",
    "^general\\b",
    "^colonel\\b",
  ].join("|"),
  "i"
);

/**
 * Final manual backstop, matched against the person's English label.
 *
 * The first group are figures no structural rule reaches. The second are
 * people whose public record is dominated by a terrorism, separatism or
 * coup-plot prosecution — Wikidata carries no conviction statement for them,
 * so rule 5 lets them through, and a player from that country would recognise
 * the face immediately whichever side of the case they take. The third are
 * names that simply do not read as a backbencher.
 */
const BLOCKED_NAME_PATTERNS = [
  /\bhitler\b/i,
  /\bmussolini\b/i,
  /\bstalin\b/i,
  /\bfranco\b/i,
  /\bputin\b/i,
  /\bkadyrov\b/i,
  /\bmilo[sš]evi[cć]\b/i,
  /\bmladi[cć]\b/i,
  /\bkaradzi[cć]\b/i,
  /\b[oö]calan\b/i,
  /\btojo\b/i,
  /\bt[oō]j[oō]\b/i,
  // Individually recognisable for one political controversy.
  /\bvoridis\b/i,
  /\bcosentino\b/i,
  /\bcuffaro\b/i,
  /\bkabas\b/i,
  /\brumpold\b/i,
  /^martin graf$/i,
  /\bwegner\b/i,
  /\bporsch\b/i,
  /\bilyukhin\b/i,
  /\begiazaryan\b/i,
  /\bayzderdzis\b/i,
  // Public record dominated by a terrorism / separatism / coup prosecution.
  /\baydar\b/i,
  /\bdicle\b/i,
  /\bsadak\b/i,
  /\bta[sş]demir\b/i,
  /\bhezer\b/i,
  /\bbalbay\b/i,
  // Does not read as a rank-and-file legislator.
  /\bprince(ss)?\b/i,
  /\bcaesar\b/i,
  /\bof thurn and taxis\b/i,
];

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * WDQS returns a transient 502/504 often enough that a country build fails
 * outright without this — retry with backoff before giving up on the country.
 */
async function runSparql(query, attempts = 4) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const data = await fetchJson(url);
      return data.results.bindings;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
  throw lastError;
}

const qidOf = (binding) => binding.value.split("/").pop();

function* chunk(items, size) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

const values = (qids) => qids.map((q) => `wd:${q}`).join(" ");

/** Query 1 — every photographed politician of the country born 1930 or later. */
async function queryRoster(countryQid, maxSitelinks) {
  const rows = await runSparql(`
SELECT ?person ?gender ?image WHERE {
  ?person wdt:P31 wd:Q5 ;
          wdt:P106 wd:Q82955 ;
          wdt:P27 wd:${countryQid} ;
          wdt:P18 ?image ;
          wdt:P21 ?gender ;
          wdt:P569 ?dob ;
          wikibase:sitelinks ?sitelinks .
  VALUES ?gender { wd:${MALE_QID} wd:${FEMALE_QID} }
  FILTER(YEAR(?dob) >= 1930)
  FILTER(?sitelinks <= ${maxSitelinks})
}
LIMIT 800`);
  const seen = new Set();
  const roster = [];
  for (const row of rows) {
    const qid = qidOf(row.person);
    if (seen.has(qid)) continue;
    seen.add(qid);
    roster.push({
      qid,
      gender: row.gender.value.endsWith(FEMALE_QID) ? "female" : "male",
      file: decodeURIComponent(row.image.value.split("/").pop()).replace(/_/g, " "),
    });
  }
  return roster;
}

/** Query 2 — the country's seat-holding positions ("member of the Dáil", …). */
async function queryLegislatureSeats(countryQid) {
  const rows = await runSparql(`
SELECT ?pos WHERE {
  ?pos wdt:P279* wd:Q486839 ;
       (wdt:P1001|wdt:P17) wd:${countryQid} .
}`);
  return new Set(rows.map((r) => qidOf(r.pos)));
}

/** A seat in a national legislature, by the position's English label. */
const SEAT_POSITION_LABEL = /^(member|senator|deputy|representative|substitute member)\b/i;

/**
 * Seats that are not a seat in *this* country's national legislature.
 * Sweden is why this exists: "member of the Swedish Riksdag" carries no
 * jurisdiction statement, so queryLegislatureSeats returns 11 positions that
 * between them cover 3 people, while the position 1,019 Swedish politicians
 * actually hold is invisible to it.
 */
const NOT_A_NATIONAL_SEAT =
  /(european parliament|s[áa]mi|municipal|county|regional|city council|provincial|local|party|committee|council of europe|nordic council|assembly of|delegate)/i;

/**
 * Derive the country's seat positions from what its own politicians hold.
 *
 * Frequency is the signal: a position held by hundreds of a country's
 * politicians is that country's legislature, whatever Wikidata does or does
 * not say about its jurisdiction. Unioned with the jurisdiction-based set so
 * countries that model it properly keep their precise answer.
 */
function deriveSeatPositions(held, labels, minHolders = 10) {
  const holders = new Map();
  for (const positions of held.values()) {
    for (const position of new Set(positions)) {
      holders.set(position, (holders.get(position) ?? 0) + 1);
    }
  }

  const derived = new Set();
  for (const [position, count] of holders) {
    if (count < minHolders) continue;
    const label = labels.get(position) ?? "";
    if (!SEAT_POSITION_LABEL.test(label)) continue;
    if (NOT_A_NATIONAL_SEAT.test(label)) continue;
    derived.add(position);
  }
  return derived;
}

/** Query 3 — every position each candidate has held. */
async function queryHeldPositions(qids) {
  const held = new Map(qids.map((q) => [q, []]));
  for (const batch of chunk(qids, 200)) {
    const rows = await runSparql(`
SELECT ?person ?pos WHERE {
  VALUES ?person { ${values(batch)} }
  OPTIONAL { ?person wdt:P39 ?pos }
}`);
    for (const row of rows) {
      if (!row.pos) continue;
      held.get(qidOf(row.person))?.push(qidOf(row.pos));
    }
  }
  return held;
}

/** Query 3b — every occupation each candidate carries. */
async function queryOccupations(qids) {
  const occupations = new Map(qids.map((q) => [q, []]));
  for (const batch of chunk(qids, 200)) {
    const rows = await runSparql(`
SELECT ?person ?occupation WHERE {
  VALUES ?person { ${values(batch)} }
  OPTIONAL { ?person wdt:P106 ?occupation }
}`);
    for (const row of rows) {
      if (!row.occupation) continue;
      occupations.get(qidOf(row.person))?.push(qidOf(row.occupation));
    }
  }
  return occupations;
}

/** Query 4 — English labels for a set of items (people or positions). */
async function queryLabels(qids) {
  const labels = new Map();
  for (const batch of chunk([...qids], 300)) {
    const rows = await runSparql(`
SELECT ?item ?itemLabel WHERE {
  VALUES ?item { ${values(batch)} }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}`);
    for (const row of rows) labels.set(qidOf(row.item), row.itemLabel?.value ?? "");
  }
  return labels;
}

/** Query 5 — party memberships and convictions for the candidate set. */
async function queryPartiesAndConvictions(qids) {
  const parties = new Map(qids.map((q) => [q, []]));
  const convicted = new Set();
  for (const batch of chunk(qids, 200)) {
    const rows = await runSparql(`
SELECT ?person ?party WHERE {
  VALUES ?person { ${values(batch)} }
  OPTIONAL { ?person wdt:P102 ?party }
}`);
    for (const row of rows) {
      if (!row.party) continue;
      parties.get(qidOf(row.person))?.push(qidOf(row.party));
    }
    const convictionRows = await runSparql(`
SELECT ?person WHERE {
  VALUES ?person { ${values(batch)} }
  ?person wdt:P1399 ?conviction .
}`);
    for (const row of convictionRows) convicted.add(qidOf(row.person));
  }
  return { parties, convicted };
}

/** Resolve Commons filenames to 400px-wide thumbnail URLs, 50 at a time. */
async function resolveThumbs(files) {
  const out = new Map();
  for (const batch of chunk(files, 50)) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "400",
      titles: batch.map((f) => `File:${f}`).join("|"),
    });
    const data = await fetchJson(`${COMMONS_API}?${params}`);
    const normalized = new Map(
      (data.query?.normalized ?? []).map((n) => [n.to, n.from.replace(/^File:/, "")])
    );
    for (const page of Object.values(data.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      if (!info?.thumburl) continue;
      if (info.mime && !["image/jpeg", "image/png"].includes(info.mime)) continue;
      out.set(normalized.get(page.title) ?? page.title.replace(/^File:/, ""), info.thumburl);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}

function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Wikidata labels sometimes carry a disambiguating parenthetical
 * ("Li Suwen (died 2022)"). Strip it — the pool stores a person's name, and
 * the annotation would end up in the id slug.
 */
function cleanName(name) {
  return name.replace(/\s*\([^)]*\)/g, "").trim();
}

function isUsableName(name) {
  if (!name || /^Q\d+$/.test(name)) return false;
  if (name.trim().split(/\s+/).length < 2) return false;
  return !BLOCKED_NAME_PATTERNS.some((re) => re.test(name));
}

/** Fill the female target first, then top up with men, then with whoever is left. */
function balance(people) {
  const women = people.filter((p) => p.gender === "female");
  const men = people.filter((p) => p.gender === "male");
  const femaleTake = Math.min(women.length, TARGET_FEMALE);
  const chosen = [...women.slice(0, femaleTake), ...men.slice(0, TARGET_PER_COUNTRY - femaleTake)];
  if (chosen.length < TARGET_PER_COUNTRY) {
    const used = new Set(chosen.map((p) => p.qid));
    for (const person of [...women, ...men]) {
      if (chosen.length >= TARGET_PER_COUNTRY) break;
      if (!used.has(person.qid)) chosen.push(person);
    }
  }
  return chosen;
}

/**
 * Build one country's pool at a given fame cap. Returns the entries plus the
 * counts behind them so the caller can decide whether to relax the cap.
 */
async function buildCountryAtCap(countryId, maxSitelinks) {
  const { qid, ethnicity } = COUNTRIES[countryId];

  const roster = await queryRoster(qid, maxSitelinks);
  const jurisdictionSeats = await queryLegislatureSeats(qid);
  const held = await queryHeldPositions(roster.map((p) => p.qid));

  const positionLabels = await queryLabels(new Set([...held.values()].flat()));
  const seatPositions = new Set([
    ...jurisdictionSeats,
    ...deriveSeatPositions(held, positionLabels),
  ]);

  // Rule 2: keep only people who actually sat in the national legislature.
  const seated = roster.filter((p) => held.get(p.qid)?.some((pos) => seatPositions.has(pos)));

  const occupations = await queryOccupations(seated.map((p) => p.qid));
  const labels = await queryLabels(
    new Set([...seated.map((p) => p.qid), ...seated.flatMap((p) => occupations.get(p.qid) ?? [])])
  );
  for (const [position, label] of positionLabels) labels.set(position, label);
  const { parties, convicted } = await queryPartiesAndConvictions(seated.map((p) => p.qid));

  const rejected = { led: 0, celebrity: 0, convicted: 0, party: 0, name: 0, noImage: 0 };
  const candidates = [];
  for (const person of seated) {
    const name = cleanName(labels.get(person.qid) ?? "");
    if (!isUsableName(name)) {
      rejected.name++;
      continue;
    }
    // Rule 4: never led a country or a party.
    const ledSomething = (held.get(person.qid) ?? []).some((pos) =>
      LEADERSHIP_POSITION.test(labels.get(pos) ?? "")
    );
    if (ledSomething) {
      rejected.led++;
      continue;
    }
    // Rule 3: a legislator, not a celebrity or a career officer.
    const isCelebrity = (occupations.get(person.qid) ?? []).some((occ) =>
      BLOCKED_OCCUPATION.test(labels.get(occ) ?? "")
    );
    if (isCelebrity) {
      rejected.celebrity++;
      continue;
    }
    // Rule 5: no recorded conviction.
    if (convicted.has(person.qid)) {
      rejected.convicted++;
      continue;
    }
    // Rule 6: never a member of a blocked party.
    if ((parties.get(person.qid) ?? []).some((p) => BLOCKED_PARTIES.has(p))) {
      rejected.party++;
      continue;
    }
    candidates.push({ ...person, name });
  }

  const thumbs = await resolveThumbs([...new Set(candidates.map((c) => c.file))]);
  const withImages = candidates.filter((c) => {
    if (thumbs.has(c.file)) return true;
    rejected.noImage++;
    return false;
  });

  const entries = balance(withImages).map((person) => ({
    id: `${countryId.toLowerCase()}-${slugify(person.name)}`,
    name: person.name,
    country: countryId,
    gender: person.gender,
    ethnicity,
    url: thumbs.get(person.file),
  }));

  return { entries, rejected, rosterSize: roster.length, seatedSize: seated.length };
}

/**
 * Build a country, relaxing the fame cap only as far as it has to. A country
 * that fills its quota at cap 7 never looks at 12 — the escalation exists for
 * legislatures Wikidata covers thinly, not as a general widening.
 */
async function buildCountry(countryId) {
  let best = null;
  for (const cap of SITELINK_CAPS) {
    const result = await buildCountryAtCap(countryId, cap);
    const women = result.entries.filter((e) => e.gender === "female").length;
    best = { ...result, cap };
    if (result.entries.length >= TARGET_PER_COUNTRY && women >= TARGET_FEMALE) break;
  }
  return best;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const requested = args.filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
  const targets = requested.length
    ? requested
    : Object.keys(COUNTRIES).filter((c) => !HAND_CURATED.has(c));

  for (const country of targets) {
    if (!COUNTRIES[country]) throw new Error(`Unknown country ${country}`);
  }

  const existing = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  const kept = existing.filter((p) => !targets.includes(p.country));
  const added = [];

  for (const countryId of targets) {
    process.stdout.write(`${countryId}: `);
    try {
      const { entries, rejected, rosterSize, seatedSize, cap } = await buildCountry(countryId);
      added.push(...entries);
      const women = entries.filter((e) => e.gender === "female").length;
      console.log(
        `${entries.length} portraits (${women}F/${entries.length - women}M) ` +
          `at fame cap ${cap} — roster ${rosterSize} → seated ${seatedSize} → dropped ` +
          `${rejected.led} leaders, ${rejected.celebrity} celebrities, ` +
          `${rejected.convicted} convicted, ` +
          `${rejected.party} blocked party, ${rejected.name} unusable name, ` +
          `${rejected.noImage} no image`
      );
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      // Keep whatever this country already had rather than dropping its pool.
      kept.push(...existing.filter((p) => p.country === countryId));
    }
  }

  const merged = new Map([...kept, ...added].map((p) => [p.id, p]));
  const final = [...merged.values()];
  const countries = new Set(final.map((p) => p.country));

  console.log(`\nTotal: ${final.length} portraits across ${countries.size} countries`);
  if (dryRun) {
    console.log("--dry-run: nothing written");
    return;
  }
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(final, null, 2)}\n`);
  console.log(`Wrote ${DATA_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
