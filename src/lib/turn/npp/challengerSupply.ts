/**
 * Challenger supply fields existing regional NPPs into uncovered primaries.
 * Only non-player countries receive generated replacements, including during
 * Founding. See processChallengerGeneration.
 */
import { buildNppElectionEligiblePartyKeys } from "@/lib/parties/antiAbuseGuards";
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
import { createNPP, calculateQualityBonus, type NPPGenerationContext } from "@/lib/npp/generator";
import { canPartyFieldInState } from "@/lib/turn/nppEntryLogic";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";
import { isActiveElectionCandidateDuplicateKey } from "@/lib/elections/duplicateKey";
import { getAllCountryAccess } from "@/lib/countryAccess";
import { getChallengerSupplyPolicy } from "./rules/challengerSupply";

/**
 * Directly-elected SINGLE-SEAT offices that need a bench challenger to be
 * contested. Multi-seat chambers normally field both parties via incumbent
 * defense, but a vacant chamber has no incumbent supply.
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

/**
 * Regional chambers whose concurrent cycles can exhaust the whole local NPP
 * pool. These need the same per-party floor as single-seat races even in
 * multi-party countries. Without it, a higher-priority or older overlapping
 * race can claim every eligible NPP and leave the residual chamber empty.
 */
const CONTESTABLE_CONCURRENT_CHAMBERS = ["house", "milletMeclisi", "senato"] as const;

/**
 * Direct contest families observed empty in the 2027 qualification replay.
 * These are not all represented in the generic NPP race-priority list, and a
 * newly spawned cycle can have no incumbent to defend it. Give them the same
 * bounded floor as the established chamber families.
 */
const CONTESTABLE_QUALIFICATION_FAMILIES = [
  "ministerPresident",
  "congresoDiputados",
  "senado",
  "eduskunta",
  "vouli",
  "dail",
  "localCouncil",
  "sangiin",
  "president",
  "regionalCouncil",
  // The 1991 successor parliaments have no incumbent supply at opening.
  "nationalAssembly",
  "sejm",
  "senat",
  "chamberOfDeputies",
  // 1991 Soviet Congress and SFRY Federal Chamber: no seated delegation to
  // defend, so a cycle opened after the Founding needs the same floor.
  "unionCongressDeputy",
  "federalAssembly",
] as const;

/** All election types this phase files a floor candidate into. */
const CONTESTABLE = [
  ...CONTESTABLE_SINGLE_SEAT,
  ...CONTESTABLE_MULTI_SEAT_ONEPARTY,
  ...CONTESTABLE_CONCURRENT_CHAMBERS,
  ...CONTESTABLE_QUALIFICATION_FAMILIES,
] as const;

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
/**
 * File bench "challenger" candidates into open primaries that would otherwise
 * resolve UNCONTESTED / EMPTY:
 *   - directly-elected single-seat offices (governor, senate), and
 *   - one-party multi-seat sub-national congresses (CN peoplesCongress), and
 *   - regional chambers vulnerable to concurrent-cycle pool exhaustion.
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
 * NPP from that (party, home-state) bucket when one exists. Only non-player
 * countries may generate a replacement via `createNPP` (positions inherited
 * from the party doc, so a correctly-seeded party yields a correctly-positioned
 * challenger).
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

  // Open covered primaries: active AND still in the primary window
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
  // Runtime access overrides matter: a country can be opened to players without
  // a deploy. Resolve once for the phase, never once per race or party.
  const countryAccess = await getAllCountryAccess(db);

  // Top-2 default ("major") parties per country — same convention as the admin
  // generator and the party-fielding gate.
  const partyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      { defunct: { $ne: true }, regimeStatus: { $ne: "banned" } },
      {
        projection: {
          sequentialId: 1,
          countryId: 1,
          isDefault: 1,
          tier: 1,
          createdTurn: 1,
          nppElectionMatureAtTurn: 1,
          createdAt: 1,
        },
      }
    )
    .toArray();
  const eligibleKeys = buildNppElectionEligiblePartyKeys(partyDocs, now, currentTurn);
  const defaultsByCountry = new Map<string, number>();
  const majorsByCountry = new Map<string, string[]>();
  for (const p of partyDocs) {
    const cty = String(p.countryId ?? "US");
    const list = majorsByCountry.get(cty) ?? [];
    // Founding: field the country's WHOLE default roster so the chamber it
    // seats reflects the era's real party system. Steady state: top-2 only,
    // which is all a single-seat race needs to become a contest.
    const defaultCount = defaultsByCountry.get(cty) ?? 0;
    if (!eligibleKeys.has(`${cty}:${p.sequentialId}`)) continue;
    if (!p.isDefault || founding || defaultCount < 2) {
      if (p.isDefault) defaultsByCountry.set(cty, defaultCount + 1);
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
  const electionsWithCandidate = new Set<string>();
  const nppsInActiveCandidacy = new Set<string>();
  for (const c of cands) {
    hasCandidate.add(`${String(c._id.e)}_${c._id.p}`);
    electionsWithCandidate.add(String(c._id.e));
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
  const generationContext: NPPGenerationContext = {
    existingNames: new Set(freeNpps.map((n) => n.name)),
  };
  for (const n of freeNpps) {
    const id = String(n._id);
    if (incumbentNppIds.has(id) || nppsInActiveCandidacy.has(id)) continue;
    const k = `${n.countryId ?? "US"}:${n.party}:${n.homeState ?? ""}`;
    (freeByBucket.get(k) ?? freeByBucket.set(k, []).get(k)!).push(n);
  }

  // statePartyOrg presence + org (for the challenger's quality bonus).
  const spoRows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find(
      {},
      { projection: { countryId: 1, stateId: 1, partyId: 1, hasPresence: 1, organization: 1 } }
    )
    .toArray();
  const spoByKey = new Map<string, { hasPresence?: boolean; organization?: number }>();
  const statesWithOrg = new Set<string>();
  for (const r of spoRows) {
    spoByKey.set(`${r.countryId ?? "US"}:${r.stateId}:${r.partyId}`, {
      hasPresence: r.hasPresence,
      organization: r.organization,
    });
    statesWithOrg.add(`${r.countryId ?? "US"}:${r.stateId}`);
  }

  let filed = 0;
  for (const primary of openPrimaries) {
    if (filed >= MAX_CHALLENGERS_PER_TURN) break;
    const country = String(primary.countryId ?? "US");
    const supply = getChallengerSupplyPolicy(
      countryAccess[country as CountryId],
      primary.electionType
    );
    if (!supply.canReuse) continue;
    const state = primary.state;
    const countryParties = majorsByCountry.get(country) ?? [];
    let raceHasCandidate = electionsWithCandidate.has(String(primary._id));
    for (const party of countryParties) {
      if (filed >= MAX_CHALLENGERS_PER_TURN) break;
      if (hasCandidate.has(`${String(primary._id)}_${party}`)) continue; // party already contesting
      const spo = spoByKey.get(`${country}:${state}:${party}`);
      const partyDoc = partyDocs.find(
        (p) => String(p.countryId ?? "US") === country && String(p.sequentialId) === party
      );
      if (!partyDoc?.isDefault) {
        const nationalPresence =
          state === country &&
          spoRows.some(
            (row) => row.countryId === country && row.partyId === party && row.hasPresence
          );
        if (!spo?.hasPresence && !nationalPresence) continue;
      }

      if (!canPartyFieldInState(spo, statesWithOrg.has(`${country}:${state}`), party)) continue; // regional presence

      // Reuse a free NPP from this (country,party,state) bucket if available,
      // else generate one only in a non-player country. Paid recruitment and
      // roster limits must not be bypassed by empty races in player countries.
      const bucket = `${country}:${party}:${state}`;
      let npp = freeByBucket.get(bucket)?.pop();
      if (!npp) {
        if (!supply.canGenerate) continue;
        npp = await createNPP(
          {
            state,
            party,
            countryId: country as CountryId,
            quality: calculateQualityBonus(spo?.organization ?? 0),
          },
          generationContext
        );
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
        electionsWithCandidate.add(String(primary._id));
        nppsInActiveCandidacy.add(String(npp._id));
        raceHasCandidate = true;
        filed++;
      } catch (error) {
        // Partial unique index: one active candidacy per character. A reused free
        // NPP that was claimed elsewhere this pass just gets skipped for this race.
        if (!isActiveElectionCandidateDuplicateKey(error)) throw error;
      }
    }

    // AI-only Founding cannot converge while a cycle-0 race has no candidate or vote
    // coverage. Regional presence still controls which parties normally field,
    // but incomplete seed org data must not strand the office forever. Give a
    // wholly-empty founding race one fallback candidate from the country's first
    // default party. This also covers national executive races, whose state is
    // the country code and therefore has no statePartyOrg row by design.
    if (founding && supply.canGenerate && !raceHasCandidate && filed < MAX_CHALLENGERS_PER_TURN) {
      const party = countryParties.find((id) =>
        partyDocs.some(
          (p) =>
            p.isDefault && String(p.countryId ?? "US") === country && String(p.sequentialId) === id
        )
      );
      if (party) {
        const bucket = `${country}:${party}:${state}`;
        let npp = freeByBucket.get(bucket)?.pop();
        if (!npp) {
          npp = await createNPP(
            { state, party, countryId: country as CountryId, quality: 0 },
            generationContext
          );
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
          electionsWithCandidate.add(String(primary._id));
          nppsInActiveCandidacy.add(String(npp._id));
          filed++;
        } catch (error) {
          if (!isActiveElectionCandidateDuplicateKey(error)) throw error;
        }
      }
    }
  }

  if (filed > 0) {
    console.log(
      `[Turn] generateChallengers: filed ${filed} floor candidate(s) into uncovered primaries`
    );
  }
  return filed;
}
