import { notFound } from "next/navigation";
import { requireConflictsEnabled } from "../_coldwar/gate";
import { entityName } from "@/app/world/international-organizations/entityLabel";
import { getDb } from "@/lib/mongodb";
import { getConflictByNumber } from "@/lib/db/collections/conflicts";
import { getPeaceOffersCollection } from "@/lib/db/collections/peaceOffers";
import { warGoalLabel } from "@/lib/military/warGoals";
import { getBattleReportsCollection, theaterRecord } from "@/lib/db/collections/battleReports";
import { listDeclarationHistory } from "@/lib/db/collections/battleDeclarations";
import { getGameTime } from "@/lib/time/gameTime";
import { toConflictView, yearOfTurn } from "../_coldwar/conflictView";
import { regionCodesOfCountry } from "@/lib/maps/regionOwnership";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getMilitaryFormations } from "@/lib/db/collections/militaryFormations";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getPendingDeclaration } from "@/lib/db/collections/battleDeclarations";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { theaterCommanderOf } from "@/lib/military/assignments";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";
import { loadGeneralsById } from "@/lib/db/collections/characterGenerals";
import { resolveCommandChain } from "@/lib/military/commandChain";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { conflictTier, belligerentSideOf } from "@/lib/military/conflictVisibility";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { READINESS_DRIFT_STEP } from "@/lib/military/readinessDrift";
import { getDefenseAppropriation } from "@/lib/db/collections/defenseAppropriation";
import {
  buildRecordExtras,
  casualtiesBySide,
  declarationOutcome,
  forceReadiness,
  recoveringCount,
  type SideForce,
} from "./conflictRecordView";
import { verdictOf, openingLine, momentumOf } from "./recordCopy";
import type { MomentumMark } from "./MomentumPanel";
import type { PendingChip } from "./NextTickStrip";
import { ConflictRecord, type ConflictRecordView } from "./ConflictRecord";

/** How many engagements the record lists, newest first. */
const BATTLE_LIMIT = 50;
/** How many turns of history the momentum track spans. */
const MOMENTUM_WINDOW = 60;
/** How many events the momentum track marks, newest first. */
const MOMENTUM_MARKS = 5;

// One conflict's public record, at /world/conflicts/<conflictId>. Gated by
// `conflictsEnabled`. Works for a RESOLVED conflict too — that is the historical
// point — so the lookup does not filter on status.
//
// THE FOG RULE: everything a tier may not see is omitted HERE, on the server.
// Whatever this function puts on `conflict` lands in the HTML payload, so a field
// the viewer must not have is never merely hidden by the component.
export default async function ConflictRecordPage({
  params,
}: {
  params: Promise<{ conflictId: string }>;
}) {
  await requireConflictsEnabled();
  const { conflictId } = await params;

  // This dynamic segment would otherwise swallow any unmatched path under
  // /world/conflicts, so anything that is not a positive integer is a 404.
  if (!/^[1-9]\d*$/.test(conflictId)) notFound();

  const db = await getDb();
  const doc = await getConflictByNumber(db, Number(conflictId));
  if (!doc) notFound();

  // Accepted deals only. A pending or rejected offer is a private negotiation; an
  // accepted one is part of how the war went and belongs on the public record.
  // All independent given the conflict doc — one round instead of five.
  const [
    settlements,
    { startingYear, currentTurn, preIterationTurns },
    record,
    reports,
    declarationHistory,
  ] = await Promise.all([
    getPeaceOffersCollection(db)
      .find({ conflictId: doc._id, status: "accepted" })
      .sort({ resolvedTurn: 1 })
      .toArray(),
    getGameTime(),
    // Aggregated over the WHOLE history, not the newest-50 window below: a long
    // war's casualty figure and engagement count must not stop climbing once the
    // rendered list fills.
    theaterRecord(db, doc._id),
    getBattleReportsCollection(db)
      .find({ theaterId: doc._id })
      .sort({ turn: -1 })
      .limit(BATTLE_LIMIT)
      .toArray(),
    listDeclarationHistory(db, doc._id, 3),
  ]);
  const casualties = Object.values(record.casualtiesByCountry).reduce((a, b) => a + b, 0);
  const view = toConflictView(doc, { startingYear, casualties, preIterationTurns });

  // --- who is asking, and how much they may see ---------------------------------
  // Roles only count for a country actually in the war (belligerentSideOf uses
  // explicit roster membership, never sideOf's bloc fallback).
  const authUser = await getAuthUserWithCharacter();
  const viewerCountry = authUser?.character?.countryId ?? null;
  const viewerCharacterId = authUser?.character?._id?.toString() ?? null;
  const ownSide = viewerCountry ? belligerentSideOf(doc, viewerCountry) : null;

  // A nation that cannot fund its upkeep settles toward a suppressed readiness baseline.
  // Every recovery figure below is quoted against it, so the record never promises a
  // recovery the turn processor will not deliver.
  const viewerArrearsRatio = viewerCountry
    ? (await getDefenseAppropriation(db, viewerCountry)).arrearsRatio
    : 0;

  let isPostedGeneral = false;
  let isDefenseHolder = false;
  let isHeadOfGovernment = false;
  let isCommandingGeneral = false;
  let theaterCommander: string | null = null;
  let theaterCommanderName: string | null = null;
  let employ: ConflictRecordView["employ"] = null;
  if (viewerCountry && ownSide && viewerCharacterId) {
    const [org, seatHolder, hog, commands, generalsById] = await Promise.all([
      getMilitaryFormations(db, viewerCountry),
      getCabinetMembersCollection(db).findOne({
        countryId: viewerCountry,
        positionId: DEFENSE_POSITION_BY_COUNTRY[viewerCountry] ?? "",
      }),
      getHeadOfGovernmentCharacterId(db, viewerCountry),
      // Leading a Command is the seat that posts generals to conflicts, so the role
      // panel cannot explain the chain without knowing whether the viewer holds one.
      getMilitaryCommands(db, viewerCountry),
      loadGeneralsById(db, viewerCountry),
    ]);
    isPostedGeneral = org.conflictAssignments.some(
      (a) => a.theaterId === doc._id && a.generalCharacterId === viewerCharacterId
    );
    isDefenseHolder = seatHolder?.characterId?.toString() === viewerCharacterId;
    isHeadOfGovernment = hog?.toString() === viewerCharacterId;
    const ownCommand = commands.find((c) => c.commandingGeneralId === viewerCharacterId) ?? null;
    isCommandingGeneral = ownCommand !== null;
    theaterCommander = theaterCommanderOf(org.conflictAssignments, doc._id);
    // Who holds a theater is public — the designation is an act of state — so the
    // name is resolved for every seat, not only the ones that can act on it.
    theaterCommanderName = theaterCommander ? (generalsById[theaterCommander]?.name ?? null) : null;

    // The Commanding General's lever, brought to the front it applies to. Their
    // whole posting set is sent, not just this conflict's: the route merges other
    // commands' rows back but replaces this CG's own wholesale, so omitting the
    // rest would recall every general they have posted elsewhere.
    if (ownCommand && doc.status !== "resolved") {
      const ownUnits = await getMilitaryUnitsCollection(db)
        .find({ countryId: viewerCountry })
        .toArray();
      const ownIds = new Set(ownCommand.commanderIds);
      employ = {
        countryCode: viewerCountry.toLowerCase(),
        theaterId: doc._id,
        generals: ownCommand.commanderIds.map((id) => {
          // A general's force is DERIVED from assignedGeneralId — it is never
          // listed on the posting, and it travels with them.
          const led = ownUnits.filter((u) => u.assignedGeneralId === id);
          return {
            id,
            name: generalsById[id]?.name ?? "Unnamed general",
            divisions: led.length,
            men: led.reduce((s, u) => s + u.personnel, 0).toLocaleString("en-US"),
          };
        }),
        ownAssignments: org.conflictAssignments.filter((a) => ownIds.has(a.generalCharacterId)),
      };
    }
  }

  // Where the viewer stands in this war, and who does what they cannot. Split
  // authority across three seats was real but invisible, and the question it kept
  // producing was "where do I assign more troops to the battlefield?" — which has no
  // button anywhere, because units follow the general they are assigned to.
  const chain = resolveCommandChain({
    ownSide,
    isDefenseHolder,
    isCommandingGeneral,
    isPostedGeneral,
    isTheaterCommander: theaterCommander !== null && theaterCommander === viewerCharacterId,
    isAdmin: Boolean(authUser?.isAdmin),
    resolved: doc.status === "resolved",
    hasTheaterCommander: theaterCommander !== null,
    theaterCommanderName,
  });

  const tier = conflictTier({
    status: doc.status,
    side: ownSide,
    isPostedGeneral,
    isDefenseHolder,
    isHeadOfGovernment,
    isCommandingGeneral,
  });

  // Every battle route is mounted under the defence seat's cabinet position, so a
  // belligerent whose country has none has no path to declare through — the URL
  // would carry an empty `[positionId]` segment and 404. Offering the panel there
  // would be a button that cannot work.
  const defensePosition = viewerCountry ? (DEFENSE_POSITION_BY_COUNTRY[viewerCountry] ?? "") : "";

  // Narrower than canActAtTheater, deliberately. The route admits an admin; this
  // page does not, because the panel it would render sits under one that has just
  // told the viewer which seat they hold. A staff account with no office in a
  // belligerent nation was being shown a live declare button beneath the sentence
  // "You give no orders at this front". A resolved war takes no orders from
  // anyone, and a non-belligerent has nothing to declare with. Being strictly
  // narrower, this can never offer an action the route would refuse.
  const canAct =
    doc.status !== "resolved" &&
    ownSide !== null &&
    defensePosition !== "" &&
    (theaterCommander ? theaterCommander === viewerCharacterId : isDefenseHolder);

  // Units of both sides' countries; buildRecordExtras scopes them by tier.
  const belligerentCountries = [...doc.sideA.countries, ...doc.sideB.countries];
  const units =
    tier === "command"
      ? await getMilitaryUnitsCollection(db)
          .find({ countryId: { $in: belligerentCountries } })
          .toArray()
      : [];

  // The opposing side's state members are the only legal targets here; the declare
  // route re-checks side membership against the same rosters, so this only shapes the
  // picker. (It used to re-check a global bloc table, which is what let an East German
  // player be offered NATO targets here and then refused by the route.)
  //
  // The enemy FACTION is a legal target too, and in a proxy war it is the ONLY one:
  // those rosters start empty and a faction is never enrolled into one, so building
  // the picker from `countries` alone leaves a player who joined the war with
  // nothing to attack — while the declare route would have accepted the faction
  // perfectly well.
  const enemySide = ownSide === "A" ? doc.sideB : doc.sideA;
  const enemyCountries = [
    ...enemySide.countries,
    ...(enemySide.factionEntity ? [enemySide.factionEntity] : []),
  ];
  const ownSpectrum =
    ownSide === "A"
      ? (doc.sideA.backer ?? "neutral")
      : ownSide === "B"
        ? (doc.sideB.backer ?? "neutral")
        : "neutral";
  const pendingDecl =
    canAct && viewerCountry ? await getPendingDeclaration(db, viewerCountry, doc._id) : null;
  const actions =
    canAct && viewerCountry
      ? {
          theaterId: doc._id,
          countryCode: viewerCountry.toLowerCase(),
          positionId: defensePosition,
          targets: [...enemyCountries],
          pendingTarget: pendingDecl?.targetCountry ?? null,
          declarationHistory: declarationHistory.map((d) => {
            // The report this declaration produced. A merged offensive writes ONE
            // report under its principal declarer, so an ally who joined someone
            // else's push matches nothing here and simply reports no outcome.
            const report =
              reports.find(
                (r) =>
                  r.turn === d.resolvedTurn &&
                  r.declarerCountry === d.declarerCountry &&
                  r.targetCountry === d.targetCountry
              ) ?? null;
            const { label, declarerWon } = declarationOutcome(report, d.status);
            // Whose result this is. The list is not filtered by country — both sides'
            // offensives appear — so "won" is coloured by whether it went the VIEWER's
            // way, not by whether the declarer prevailed.
            const declarerSide = belligerentSideOf(doc, d.declarerCountry);
            const favorable =
              declarerWon === null || ownSide === null || declarerSide === null
                ? null
                : (declarerSide === ownSide) === declarerWon;
            return {
              id: d._id.toString(),
              declarerCountry: d.declarerCountry,
              targetCountry: d.targetCountry,
              declaredTurn: d.declaredTurn,
              resolvedTurn: d.resolvedTurn ?? null,
              status: d.status,
              outcome: label,
              favorable,
            };
          }),
          ownSpectrum,
        }
      : null;

  const extras = buildRecordExtras({
    tier,
    ownSide,
    theaterId: doc._id,
    sideACountries: [...doc.sideA.countries],
    sideBCountries: [...doc.sideB.countries],
    units,
    reports,
  });

  const hostRegionCodes = await regionCodesOfCountry(db, doc.hostCountry);

  // --- both sides' live force, at the resolution the tier allows ----------------
  const sideACountries = [...doc.sideA.countries] as string[];
  const sideBCountries = [...doc.sideB.countries] as string[];
  const deaths = casualtiesBySide(record.casualtiesByCountry, sideACountries, sideBCountries);
  const atFront = units.filter((u) => u.theaterId === doc._id);
  const unitsOf = (countries: string[]): MilitaryUnit[] =>
    atFront.filter((u) => countries.includes(u.countryId));

  /**
   * A side's force as this viewer may state it. `null` fields are what the server
   * WITHHELD; the component renders those as "? ? ?" and never invents a value.
   * Only the viewer's own side is itemised — the opposing side gets one band, and
   * that band lives on `enemyBand`, not here.
   */
  const forceOf = (side: "A" | "B"): SideForce => {
    const countries = side === "A" ? sideACountries : sideBCountries;
    const casualtyTotal = side === "A" ? deaths.A : deaths.B;
    // Composition is visible only for the viewer's OWN side at command tier, or
    // for both once the war has resolved into the open record.
    const visible = tier === "archive" || (tier === "command" && ownSide === side);
    if (!visible) {
      return {
        divisions: null,
        personnel: null,
        readiness: null,
        recovery: null,
        casualties: casualtyTotal,
      };
    }
    const own = unitsOf(countries);
    const rdy = forceReadiness(own, viewerArrearsRatio);
    return {
      divisions: own.length,
      personnel: own.reduce((s, u) => s + u.personnel, 0),
      readiness: rdy?.readiness ?? null,
      recovery: rdy?.recovery ?? null,
      casualties: casualtyTotal,
    };
  };

  // Whether the OPPOSING side is at this front is not composition — an empty
  // front announces itself, which is why `enemyBand` says "No forces detected"
  // rather than withholding. Derived from the same unit set the band is.
  const enemyAtFront = ownSide ? unitsOf(ownSide === "A" ? sideBCountries : sideACountries) : [];
  const forceA = forceOf("A");
  const forceB = forceOf("B");
  if (tier === "command" && ownSide) {
    const enemyForce = ownSide === "A" ? forceB : forceA;
    if (enemyAtFront.length === 0) enemyForce.divisions = 0;
  }

  // --- the derived English ------------------------------------------------------
  const controlStart = doc.controlStart ?? 50;
  const hostIsBelligerent =
    sideACountries.includes(doc.hostCountry) || sideBCountries.includes(doc.hostCountry);
  const startYear = yearOfTurn(doc.startTurn, startingYear, { preIterationTurns });
  // Prose names the country; chips and labels keep the code. "Warsaw Pact is
  // well ahead in DE" is a database row read aloud, not a sentence.
  //
  // `entityName`, not a COUNTRY_CONFIGS lookup: a proxy war's host is a world entity
  // with no CountryConfig, so the bare lookup fell through to the raw id and printed
  // "well ahead in SVN". The alignment roster names every entity the world models.
  const hostName = entityName(doc.hostCountry);

  const verdict = verdictOf({
    control: doc.control,
    controlStart,
    sideALabel: doc.sideA.label,
    sideBLabel: doc.sideB.label,
    hostCountry: hostName,
    engagements: record.engagements,
    unopposedAdvances: record.unopposedAdvances,
    casualties,
    startYear,
  });

  // --- momentum: the events that moved the line, on a turn track ----------------
  const fromTurn = Math.max(doc.startTurn, currentTurn - MOMENTUM_WINDOW);
  const inWindow = reports.filter((r) => r.turn >= fromTurn);
  const recentGainA = inWindow.reduce(
    (sum, r) =>
      r.controlBefore == null || r.controlAfter == null
        ? sum
        : sum + (r.controlBefore - r.controlAfter),
    0
  );
  const marks: MomentumMark[] = inWindow
    .slice(0, MOMENTUM_MARKS)
    .map((r, i): MomentumMark => {
      const declarerSide = sideACountries.includes(r.declarerCountry) ? "A" : "B";
      const moved =
        r.controlBefore != null && r.controlAfter != null
          ? Math.round((r.controlBefore - r.controlAfter) * 10) / 10
          : null;
      const forDeclarer = moved == null ? null : declarerSide === "A" ? moved : -moved;
      return {
        turn: r.turn,
        label:
          forDeclarer != null && Math.abs(forDeclarer) >= 0.1
            ? `${forDeclarer > 0 ? "+" : "−"}${Math.abs(forDeclarer)} PTS`
            : `T${r.turn}`,
        side: declarerSide,
        // Alternate rows so adjacent labels on a busy front do not overlap.
        row: i % 3,
      };
    })
    .reverse();

  const momentum = momentumOf({
    sideALabel: doc.sideA.label,
    sideBLabel: doc.sideB.label,
    recentGainA,
    engagements: record.engagements,
    unopposedAdvances: record.unopposedAdvances,
    casualties,
    contested: record.engagements > 0,
  });

  // --- what resolves at the next tick -------------------------------------------
  const pending: PendingChip[] = [];
  if (pendingDecl) {
    pending.push({
      text: `Your offensive against ${pendingDecl.targetCountry}`,
      when: `resolves T${currentTurn + 1}`,
      tone: "own",
    });
  }
  const ownAtFront = ownSide ? unitsOf(ownSide === "A" ? sideACountries : sideBCountries) : [];
  // Through the shared helper, not a second copy of its `?? 72` fallback: the baseline a
  // posture settles at is one rule, and this is the tick's own — including the arrears
  // suppression, without which this counts formations that will never actually climb.
  const recovering = recoveringCount(ownAtFront, viewerArrearsRatio);
  if (recovering > 0) {
    pending.push({
      text: `${recovering} formation${recovering === 1 ? "" : "s"} recovering readiness`,
      when: `+${READINESS_DRIFT_STEP}%`,
      tone: "plain",
    });
  }
  if (pending.length === 0) {
    pending.push({
      text: canAct
        ? "No offensive declared — the line holds"
        : "Nothing of yours resolves at this front",
      when: "the line holds",
      tone: "quiet",
    });
  }

  // A nation whose units have fought here cannot walk away from the war — the one
  // consequence of deploying that the record has to state before it is incurred.
  const committedCountry =
    viewerCountry && ownSide && record.countriesEngaged.includes(viewerCountry)
      ? viewerCountry
      : null;

  const whoDeclares = theaterCommanderName
    ? `${theaterCommanderName}, Theater Commander at this front.`
    : theaterCommander
      ? "The Theater Commander designated for this conflict."
      : "The defense secretary — no Theater Commander is designated at this front.";

  const conflict: ConflictRecordView = {
    conflictId: doc.conflictId,
    name: doc.name,
    type: doc.type,
    hostCountry: doc.hostCountry,
    region: view.region,
    years: view.years,
    startYear,
    currentTurn,
    status: doc.status,
    statusLabel: doc.status.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
    // Only shown when the war was actually declared. warGoalLabel would otherwise
    // print "Undeclared" on every seeded or event-created conflict.
    ...(doc.warGoal ? { warGoal: warGoalLabel(doc.warGoal) } : {}),
    sideALabel: doc.sideA.label,
    sideBLabel: doc.sideB.label,
    sideACountries,
    sideBCountries,
    sideAFaction: doc.sideA.factionEntity,
    sideBFaction: doc.sideB.factionEntity,
    control: doc.control,
    controlStart,
    hostRegionCodes,
    hostIsBelligerent,
    verdict: verdict.headline,
    verdictDetail: verdict.detail,
    opening: openingLine({
      controlStart,
      sideALabel: doc.sideA.label,
      sideBLabel: doc.sideB.label,
      hostCountry: hostName,
      hostIsBelligerent,
      startYear,
    }),
    casualties,
    engagements: record.engagements,
    unopposedAdvances: record.unopposedAdvances,
    // The most recent thing that HAPPENED, whichever kind it was: an unopposed
    // front whose last engagement is "—" reads as broken rather than uncontested.
    lastEventLabel:
      record.lastEngagementTurn != null || record.lastAdvanceTurn == null
        ? "LAST ENGAGEMENT"
        : "LAST ADVANCE",
    lastEventValue:
      record.lastEngagementTurn != null
        ? `T${record.lastEngagementTurn}`
        : record.lastAdvanceTurn != null
          ? `T${record.lastAdvanceTurn}`
          : "none",
    pending,
    momentum: {
      control: doc.control,
      fromTurn,
      toTurn: currentTurn,
      marks,
      tag: momentum.tag,
      tagColor: momentum.tagColor,
      note: momentum.note,
      sideBLabel: doc.sideB.label,
    },
    settlements: settlements.map((o) => ({
      id: o._id.toString(),
      leaver: o.fromCountry,
      other: o.toCountry,
      indemnity: o.indemnity,
      justification: o.justification ?? null,
      turn: o.resolvedTurn ?? o.offeredTurn,
    })),
    tier,
    canAct,
    viewerCountry,
    ownSide,
    // No character means no seat to describe — a logged-out reader of the public
    // record does not need to be told they hold none.
    chain: viewerCharacterId ? chain : null,
    actions,
    employ,
    whoDeclares,
    committedCountry,
    committedDead: committedCountry ? (record.casualtiesByCountry[committedCountry] ?? 0) : 0,
    forceA,
    forceB,
    // Engagements + any tier-unlocked forces. Fog is applied HERE, on the server:
    // whatever lands in these props lands in the HTML payload.
    battles: extras.battles,
    ownForces: extras.ownForces,
    enemyBand: extras.enemyBand,
    arrearsRatio: viewerArrearsRatio,
  };

  return <ConflictRecord conflict={conflict} />;
}
