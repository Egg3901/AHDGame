import { getDb } from "@/lib/mongodb";
import type {
  Election,
  ElectionCandidate,
  NPP,
  PoliticalParty,
  GameState,
  StatePartyOrg,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { createNPP, calculateQualityBonus } from "@/lib/npp/generator";
import { canPartyFieldInState } from "@/lib/turn/nppEntryLogic";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";
import { isActiveElectionCandidateDuplicateKey } from "@/lib/elections/duplicateKey";

/**
 * Directly-elected SINGLE-SEAT offices that need a bench challenger to be
 * contested. Multi-seat chambers normally field both parties via incumbent
 * defense; the indirectly-elected executives (president/primeMinister/
 * chancellor/ministerPresident) resolve through government formation, not a
 * primary, so they are out of scope.
 */
const CONTESTABLE_SINGLE_SEAT = ["governor", "special_governor", "senate"] as const;

/**
 * One-party-state MULTI-SEAT sub-national congress types that also need a
 * direct candidate floor. The "incumbent defense fields the chamber"
 * assumption above breaks for a one-party congress that starts with NO seeded
 * incumbents (e.g. a fresh standup, or a preset that doesn't seed the chamber):
 * with no seat-holders to defend and only the scarce priority-ordered generic
 * fill left, the primary can close with ZERO candidates and the whole chamber
 * resolves EMPTY — never populated by an election (#3388).
 *
 * CN Provincial People's Congress (`peoplesCongress`) is the CN case. The RU
 * Supreme Soviet families are tracked separately (#3387/#3388 RU half) and are
 * intentionally NOT listed here. DD Land assemblies (`landAssembly`) are the
 * East German analog of CN's provincial congress — vacant at founding until
 * backfill/challenger supply seats them (ticket #1044).
 */
const CONTESTABLE_MULTI_SEAT_ONEPARTY = ["peoplesCongress", "landAssembly"] as const;

/** All election types this phase files a floor candidate into. */
const CONTESTABLE = [...CONTESTABLE_SINGLE_SEAT, ...CONTESTABLE_MULTI_SEAT_ONEPARTY] as const;

/** Circuit breaker against malformed data — real turns file a handful. */
const MAX_CHALLENGERS_PER_TURN = 400;

/**
 * During the pre-iteration FOUNDING phase this phase widens to every cycle-0
 * race, and fields EVERY default party rather than just the top two.
 *
 * The founding phase is the "fresh standup" case above taken to its limit:
 * chambers seed vacant on purpose, so there is not one incumbent anywhere in
 * the world to defend a seat, and the entire field has to come from the scarce
 * priority-ordered generic fill in `electionEntry` — which hands out at most one
 * NPP per (party, home-state) per turn while every race in the world is open at
 * once. Measured on a 1953-default founding sim (3 seeds, turns 1-49):
 *
 *   - 44% of founding races (293/669) closed with ZERO candidates and seated
 *     nobody — AT, DE, FI, FR, GR, IT, SE and TR founded with every single race
 *     empty, plus all 11 DE Landtage, all 12 UK regional councils, both JP
 *     Sangiin classes and every JP/NG regional council;
 *   - a further 22% drew exactly one candidate (a coronation, not an election);
 *   - only 34% were contested at all.
 *
 * Fielding every default party (not the top two) is deliberate: a founding that
 * seats Italy's Camera from a two-way race produces a two-party chamber for a
 * five-party country, and cross-seed outcome variance measured 9% — the founding
 * was replaying the seed file rather than holding an election. One-party states
 * are unaffected: they have exactly one default party, so they still found with
 * a single-party ballot, which is the correct 1953 behaviour.
 */
const FOUNDING_ENTRY_BLOCKED_TYPES: ReadonlySet<string> = new Set([
  // NPPs are barred from presidential races engine-wide because a player should
  // always be able to contest the presidency. Autonomous economy-only countries
  // receive presidential candidates through electionEntry's national pass.
  "president",
]);

/**
 * File bench "challenger" candidates into open primaries that would otherwise
 * resolve UNCONTESTED / EMPTY:
 *   - directly-elected single-seat offices (governor, senate), and
 *   - one-party multi-seat sub-national congresses (CN peoplesCongress).
 *
 * Single-winner races seat exactly one incumbent, so to be a contest the OTHER
 * major party needs a candidate. The generic NPP entry (nppBehavior Phase 2)
 * consumes its scarce free-NPP pool highest-RACE_PRIORITY-first, so governor
 * (LAST in RACE_PRIORITY) is starved and its short primary window closes empty —
 * Governor came back {0 candidates : 50 races} in the elections-only sim.
 *
 * A one-party congress (CN People's Congress) that starts with no seeded
 * incumbents has no seat-holders to defend, so it too relies entirely on that
 * scarce generic fill and can close with ZERO candidates — the chamber never
 * gets populated (#3388). Filing the ruling/approved default parties directly
 * here guarantees the primary is non-empty so the multi-seat PR general seats
 * winners.
 *
 * This phase runs just before nppBehavior and files the challenger DIRECTLY into
 * the specific primary (not via the priority-ordered Phase-2 fill), so the
 * lowest-priority race is guaranteed a candidate. It reuses an available free
 * NPP from that (party, home-state) bucket when one exists, else generates one
 * via the canonical `createNPP` (positions inherited from the party doc, so a
 * correctly-seeded party yields a correctly-positioned challenger).
 *
 * Bounded + self-extinguishing: only fires for an open single-seat primary that
 * (a) has no candidate for that major party, (b) where the party has genuine
 * regional presence. Once filed, the party has a candidate and the condition
 * stops. nppBehavior's own Phase-2 (which reloads context after this phase) then
 * sees the filed candidate and does not double-fill. Runs in both the live
 * engine and the elections-only sim. Returns the number of candidates filed.
 */
export async function processChallengerGeneration(now: Date): Promise<number> {
  const db = await getDb();

  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1, preIteration: 1 } });
  const currentTurn = gs?.currentTurn;
  const founding = gs?.preIteration?.active === true;

  // Open single-seat primaries: active AND still in the primary window
  // (turn-first, drift-immune — mirrors loadNPPContext's electionFilter).
  const primaryOpen =
    typeof currentTurn === "number"
      ? [
          { primaryEndTurn: { $gt: currentTurn } },
          { primaryEndTurn: { $exists: false }, primaryEndTime: { $gt: now } },
        ]
      : [{ primaryEndTime: { $gt: now } }];
  const openPrimaries = await db
    .collection<Election>("elections")
    .find(
      founding
        ? {
            status: "active",
            cycle: 0,
            electionType: { $nin: [...FOUNDING_ENTRY_BLOCKED_TYPES] },
            $or: primaryOpen,
          }
        : {
            status: "active",
            electionType: { $in: CONTESTABLE as unknown as string[] },
            $or: primaryOpen,
          },
      { projection: { _id: 1, electionType: 1, state: 1, countryId: 1 } }
    )
    .toArray();
  if (openPrimaries.length === 0) return 0;

  // Top-2 default ("major") parties per country — same convention as the admin
  // generator and the party-fielding gate.
  const partyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ isDefault: true }, { projection: { sequentialId: 1, countryId: 1 } })
    .toArray();
  const majorsByCountry = new Map<string, string[]>();
  for (const p of partyDocs) {
    const cty = String(p.countryId ?? "US");
    const list = majorsByCountry.get(cty) ?? [];
    // Founding: field the country's WHOLE default roster so the chamber it
    // seats reflects the era's real party system. Steady state: top-2 only,
    // which is all a single-seat race needs to become a contest.
    if (founding || list.length < 2) {
      list.push(String(p.sequentialId));
      majorsByCountry.set(cty, list);
    }
  }

  // (election, party) pairs that already have an active candidate — don't double-file.
  const cands = await db
    .collection("electionCandidates")
    .aggregate<{ _id: { e: unknown; p: string }; nppIds: unknown[] }>([
      { $match: { status: "active" } },
      { $group: { _id: { e: "$electionId", p: "$party" }, nppIds: { $addToSet: "$nppId" } } },
    ])
    .toArray();
  const hasCandidate = new Set<string>();
  const nppsInActiveCandidacy = new Set<string>();
  for (const c of cands) {
    hasCandidate.add(`${String(c._id.e)}_${c._id.p}`);
    for (const id of c.nppIds) if (id != null) nppsInActiveCandidacy.add(String(id));
  }

  // Incumbents (hold a seat) are not "free". Reusable free NPPs = non-retired,
  // non-technocrat, non-incumbent, not already an active candidate — grouped by
  // (country:party:home-state) so we can hand one to a primary in its own state.
  const incumbentNppIds = new Set(
    (
      await db
        .collection<{ nppId?: unknown }>("electedOfficials")
        .find({ nppId: { $exists: true, $ne: null } }, { projection: { nppId: 1 } })
        .toArray()
    ).map((o) => String(o.nppId))
  );
  const freeNpps = await db
    .collection<NPP>("npps")
    .find(
      { retiredAt: null, isTechnocrat: { $ne: true } },
      { projection: { _id: 1, name: 1, party: 1, countryId: 1, homeState: 1 } }
    )
    .toArray();
  const freeByBucket = new Map<string, NPP[]>();
  for (const n of freeNpps) {
    const id = String(n._id);
    if (incumbentNppIds.has(id) || nppsInActiveCandidacy.has(id)) continue;
    const k = `${n.countryId ?? "US"}:${n.party}:${n.homeState ?? ""}`;
    (freeByBucket.get(k) ?? freeByBucket.set(k, []).get(k)!).push(n);
  }

  // statePartyOrg presence + org (for the challenger's quality bonus).
  const spoRows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({}, { projection: { stateId: 1, partyId: 1, hasPresence: 1, organization: 1 } })
    .toArray();
  const spoByKey = new Map<string, { hasPresence?: boolean; organization?: number }>();
  const statesWithOrg = new Set<string>();
  for (const r of spoRows) {
    spoByKey.set(`${r.stateId}:${r.partyId}`, {
      hasPresence: r.hasPresence,
      organization: r.organization,
    });
    statesWithOrg.add(r.stateId);
  }

  let filed = 0;
  for (const primary of openPrimaries) {
    if (filed >= MAX_CHALLENGERS_PER_TURN) break;
    const country = String(primary.countryId ?? "US");
    const state = primary.state;
    for (const party of majorsByCountry.get(country) ?? []) {
      if (filed >= MAX_CHALLENGERS_PER_TURN) break;
      if (hasCandidate.has(`${String(primary._id)}_${party}`)) continue; // party already contesting
      const spo = spoByKey.get(`${state}:${party}`);
      if (!canPartyFieldInState(spo, statesWithOrg.has(state), party)) continue; // regional presence

      // Reuse a free NPP from this (country,party,state) bucket if available,
      // else generate one. Either way it becomes this primary's challenger.
      const bucket = `${country}:${party}:${state}`;
      let npp = freeByBucket.get(bucket)?.pop();
      if (!npp) {
        npp = await createNPP({
          state,
          party,
          countryId: country as CountryId,
          quality: calculateQualityBonus(spo?.organization ?? 0),
        });
      }

      const candidateDoc: Omit<ElectionCandidate, "_id"> = {
        electionId: primary._id,
        countryId: (primary.countryId ?? npp.countryId ?? "US") as ElectionCandidate["countryId"],
        characterId: npp._id,
        characterName: npp.name,
        party: npp.party,
        status: "active",
        support: DEFAULT_CANDIDATE_SUPPORT,
        enteredAt: now,
        isNPP: true,
        nppId: npp._id,
      };
      try {
        await db
          .collection<ElectionCandidate>("electionCandidates")
          .insertOne(candidateDoc as ElectionCandidate);
        hasCandidate.add(`${String(primary._id)}_${party}`);
        nppsInActiveCandidacy.add(String(npp._id));
        filed++;
      } catch (error) {
        // Partial unique index: one active candidacy per character. A reused free
        // NPP that was claimed elsewhere this pass just gets skipped for this race.
        if (!isActiveElectionCandidateDuplicateKey(error)) throw error;
      }
    }
  }

  if (filed > 0) {
    console.log(
      `[Turn] generateChallengers: filed ${filed} floor candidate(s) into uncontested single-seat / one-party congress primaries`
    );
  }
  return filed;
}
