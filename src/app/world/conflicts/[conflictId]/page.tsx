import { recentNavairEngagements } from "@/lib/db/collections/navairEngagements";
import { conflictRegions } from "@/lib/military/conflictRegions";
import { region as regionNameOf } from "@/lib/navair/map";
import { frontSupportFor } from "@/lib/navair/frontSupport";
import { loadNavairChannels } from "@/lib/db/collections/navairChannels";
import type { NavairUnit } from "@/lib/navair/types";
import { notFound } from "next/navigation";
import { requireConflictsEnabled } from "../_coldwar/gate";
import { entityName } from "@/app/world/international-organizations/entityLabel";
import { getDb } from "@/lib/mongodb";
import { getConflictByNumber } from "@/lib/db/collections/conflicts";
import { getPeaceOffersCollection } from "@/lib/db/collections/peaceOffers";
import { loadPartyChoices, loadPartyChoicesFor, partyDisplayName } from "@/lib/military/peaceOffer";
import { warGoalLabel } from "@/lib/military/warGoals";
import { getBattleReportsCollection, theaterRecord } from "@/lib/db/collections/battleReports";
import { listDeclarationHistory } from "@/lib/db/collections/battleDeclarations";
import { getGameTime } from "@/lib/time/gameTime";
import { toConflictView, yearOfTurn } from "../_coldwar/conflictView";
import { regionCodesOfCountry } from "@/lib/maps/regionOwnership";
import { staticZoneGeometry } from "@/lib/maps/staticZoneGeometry";
import { hostEntitiesOf } from "@/lib/military/hostEntities";
import { belligerentRoll } from "@/lib/military/belligerentRoll";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getMilitaryFormations } from "@/lib/db/collections/militaryFormations";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getPendingDeclaration } from "@/lib/db/collections/battleDeclarations";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { theaterCommanderOf } from "@/lib/military/assignments";
import { rank } from "@/lib/military/generals";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";
import { loadGeneralsById } from "@/lib/db/collections/characterGenerals";
import { resolveCommandChain } from "@/lib/military/commandChain";
import type { PostedGeneralRow } from "./PostedGeneralsPanel";
import { getCabinetSettingsCollection } from "@/lib/db/collections/cabinetSettings";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { conflictTier, belligerentSideOf } from "@/lib/military/conflictVisibility";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { archiveOpensTurn, isConflictConcluded } from "@/lib/military/conflictLifecycle";
import { requirePeaceNegotiator } from "@/lib/api/requirePeaceNegotiator";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { READINESS_DRIFT_STEP } from "@/lib/military/readinessDrift";
import { getDefenseAppropriation } from "@/lib/db/collections/defenseAppropriation";
import {
  buildRecordExtras,
  casualtiesBySide,
  declarationOutcome,
  forceReadiness,
  recoveringCount,
  settlementRow,
  type SideForce,
} from "./conflictRecordView";
import { verdictOf, openingLine, momentumOf } from "./recordCopy";
import type { MomentumMark } from "./MomentumPanel";
import type { PendingChip } from "./NextTickStrip";
import { ConflictRecord, type ConflictRecordView } from "./ConflictRecord";
import { conflictToFront } from "@/lib/military/createConflict";
import { getTheaterState } from "@/lib/db/collections/theaterState";
import { loadTermSettlement } from "@/lib/settlement/queries/termSettlement";

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
  // The department-wide readiness setting scales the SAME baseline (ticket #1140), so the
  // record has to quote against it for the same reason it quotes against the arrears.
  const viewerDefensePosition = viewerCountry
    ? DEFENSE_POSITION_BY_COUNTRY[viewerCountry as CountryId]
    : null;
  const viewerReadinessTier = viewerDefensePosition
    ? ((
        await getCabinetSettingsCollection(db).findOne({
          _id: `${viewerCountry}_${viewerDefensePosition}`,
        })
      )?.tierSetting ?? null)
    : null;

  let isPostedGeneral = false;
  let isDefenseHolder = false;
  let isHeadOfGovernment = false;
  let isCommandingGeneral = false;
  let theaterCommander: string | null = null;
  let theaterCommanderName: string | null = null;
  let employ: ConflictRecordView["employ"] = null;
  // The viewer nation's postings at this front, resolved here where the org doc and
  // the general roster are already loaded, and turned into rows once the unit query
  // below has run (a general's divisions travel with them).
  let postingsHere: {
    generalCharacterId: string;
    name: string;
    level: number;
    inCharge: boolean;
  }[] = [];
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
    // Postings held by someone the country's roster no longer contains are not real
    // postings: they cannot fight, the assignments PUT drops them on the next save,
    // and counting them here would have the page name a Theater Commander it then
    // could not list. Filtered once so every reader below agrees.
    const liveAssignments = org.conflictAssignments.filter(
      (a) => generalsById[a.generalCharacterId]
    );
    isPostedGeneral = liveAssignments.some(
      (a) => a.theaterId === doc._id && a.generalCharacterId === viewerCharacterId
    );
    isDefenseHolder = seatHolder?.characterId?.toString() === viewerCharacterId;
    isHeadOfGovernment = hog?.toString() === viewerCharacterId;
    // Leading a command is only authority while its lead is still a commissioned
    // general of this country: `requireCommandingGeneral` re-checks exactly this, so
    // trusting the stored id alone would render an Employ panel whose every button
    // the route then refuses.
    const ownCommand =
      (generalsById[viewerCharacterId]
        ? commands.find((c) => c.commandingGeneralId === viewerCharacterId)
        : undefined) ?? null;
    isCommandingGeneral = ownCommand !== null;
    theaterCommander = theaterCommanderOf(liveAssignments, doc._id);
    // Who holds a theater is public — the designation is an act of state — so the
    // name is resolved for every seat, not only the ones that can act on it.
    theaterCommanderName = theaterCommander ? (generalsById[theaterCommander]?.name ?? null) : null;

    // Every general of this nation standing at this front, Theater Commander first.
    // Their own country's only: the record's rule is that who is standing where is
    // not public, and the enemy's dispositions are never itemised anywhere.
    postingsHere = liveAssignments
      .filter((a) => a.theaterId === doc._id)
      .map((a) => ({
        generalCharacterId: a.generalCharacterId,
        name: generalsById[a.generalCharacterId].name ?? "Unnamed general",
        level: generalsById[a.generalCharacterId].level,
        inCharge: a.inCharge,
      }));

    // The Commanding General's lever, brought to the front it applies to. Their
    // whole posting set is sent, not just this conflict's: the route merges other
    // commands' rows back but replaces this CG's own wholesale, so omitting the
    // rest would recall every general they have posted elsewhere.
    // Concluded, not merely resolved: a war awaiting terms takes no more postings,
    // so offering the lever there would be a control that cannot do anything.
    if (ownCommand && !isConflictConcluded(doc.status)) {
      const ownUnits = await getMilitaryUnitsCollection(db)
        .find({ countryId: viewerCountry })
        .toArray();
      const ownIds = new Set(ownCommand.commanderIds);
      employ = {
        countryCode: viewerCountry.toLowerCase(),
        theaterId: doc._id,
        // Filtered to generals the country's roster still holds. A commander who
        // emigrated or was dismissed stays in `commanderIds` (see
        // reconcileCommandCommanders), and offering them here would render an
        // "Unnamed general" whose Post-here button the assignments PUT refuses.
        generals: ownCommand.commanderIds
          .filter((id) => generalsById[id])
          .map((id) => {
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
        ownAssignments: liveAssignments.filter((a) => ownIds.has(a.generalCharacterId)),
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
    endTurn: doc.endTurn,
    currentTurn,
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
    // Concluded, not merely resolved. A war awaiting terms has stood both rosters
    // down and the turn phase now fizzles anything declared at it, so offering the
    // panel here would be a button that cannot work.
    !isConflictConcluded(doc.status) &&
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

  // Gated on a MILITARY seat, not merely on `command` tier. The tier also admits the
  // head of government, whom `resolveCommandChain` reads as a citizen — and the
  // citizen panel says outright that who is standing where is not public. Showing
  // them the roster would have the page contradict its own copy.
  const holdsMilitarySeat = isDefenseHolder || isCommandingGeneral || isPostedGeneral;
  const postedHere: PostedGeneralRow[] | null =
    tier === "command" && holdsMilitarySeat && viewerCountry
      ? postingsHere
          .map((a) => ({
            id: a.generalCharacterId,
            name: a.name,
            rank: rank(a.level),
            divisions: units.filter(
              (u) => u.countryId === viewerCountry && u.assignedGeneralId === a.generalCharacterId
            ).length,
            inCharge: a.inCharge,
            isViewer: a.generalCharacterId === viewerCharacterId,
          }))
          .sort((a, b) => Number(b.inCharge) - Number(a.inCharge) || a.name.localeCompare(b.name))
      : null;

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
  // Party lists for every country a settlement on this war converted, in ONE
  // query: the record needs names and the terms store ids. Only the terms that
  // actually name a party contribute, so an ordinary war loads nothing.
  const settlementParties = await loadPartyChoicesFor(
    db,
    settlements
      .filter((o) => o.term.kind === "regime_change" && o.term.rulingPartyId != null)
      .map((o) => o.toCountry)
  );

  // The dictate panel, shown ONLY to the negotiator of the country that won this
  // war outright. Null for everyone else, including the losing side and the winning
  // side's allies: a coalition victory yields one term, and the panel is where that
  // is visible rather than only enforced by the route.
  const dictate =
    doc.status === "terms_pending" &&
    doc.termsWindow &&
    viewerCountry === doc.termsWindow.imposer &&
    authUser?.character?._id &&
    (
      await requirePeaceNegotiator(
        db,
        viewerCountry,
        authUser.character._id,
        authUser.isAdmin === true
      )
    ).ok
      ? {
          conflictId: doc._id,
          countryCode: viewerCountry.toLowerCase(),
          target: doc.termsWindow.target,
          targetName: COUNTRY_CONFIGS[doc.termsWindow.target]?.name ?? doc.termsWindow.target,
          turnsLeft: Math.max(0, doc.termsWindow.closesTurn - currentTurn),
          // The parties the victor may install, when they convert the loser to a
          // one-party state. Loaded from the same helper the route validates
          // against, so anything offered here is accepted there.
          targetParties: await loadPartyChoices(db, doc.termsWindow.target),
          // Offered on any war this question is riding. The victor holding the terms
          // window is a founding belligerent by construction (`openTermsWindow` names
          // `principalOf`), and EITHER founder may settle Germany, so nothing further
          // needs checking here. Same loader the route validates against.
          canDictateReunification: (await loadTermSettlement(db, doc._id)) !== null,
        }
      : null;

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
          // The viewer's own standing order at this front. Read from theatre state, so
          // it survives a change of Theater Commander the way the deployment does.
          autoJoin: Boolean((await getTheaterState(db, viewerCountry)).autoJoin?.[doc._id]),
        }
      : null;

  // The naval and air picture, read from the state `navairOperations` wrote this turn.
  // Only assembled for a belligerent, since it is command-tier sight: a spectator reading
  // the public record must not learn a nation's fleet dispositions from this page.
  const navairPanelInput = await (async () => {
    if (!ownSide) return {};
    const channels = await loadNavairChannels(db);
    const navairUnits = (await getMilitaryUnitsCollection(db)
      .find({ domain: { $in: ["naval", "air"] } })
      .toArray()) as unknown as NavairUnit[];
    const own = ownSide === "A" ? doc.sideA.countries : doc.sideB.countries;
    const foe = ownSide === "A" ? doc.sideB.countries : doc.sideA.countries;
    // Every region the war is fought across, not just the one it is named after: a war
    // that has spread has a sea war in more than one place.
    const theatre = conflictRegions(doc);
    const actions = await recentNavairEngagements(db, theatre, 5);

    return {
      navairSupport: frontSupportFor(navairUnits, channels, [...own], doc.region),
      navairEnemySupport: frontSupportFor(navairUnits, channels, [...foe], doc.region),
      navairActions: actions.map((a) => ({
        turn: a.turn,
        regionName: regionNameOf(a.region)?.name ?? a.region,
        winner: a.winner.join(", "),
        marginPct: a.marginPct,
        sunk: a.sunk,
      })),
    };
  })();

  const extras = buildRecordExtras({
    tier,
    ownSide,
    theaterId: doc._id,
    sideACountries: [...doc.sideA.countries],
    sideBCountries: [...doc.sideB.countries],
    units,
    concluded: isConflictConcluded(doc.status),
    reports,
    // So this page's enemy band and the war room's odds read the same fleet the same way.
    seaAccess: conflictToFront(doc).seaAccess,
    ...navairPanelInput,
  });

  // The whole conflict zone, not the anchor alone: the front line is placed as a
  // share of the land the map can see, so a war hosted in two countries has to
  // project both or the line is measured against half a theatre.
  const hostEntities = hostEntitiesOf(doc) as string[];
  const hostRegionCodes = [
    ...new Set(
      (await Promise.all(hostEntities.map((host) => regionCodesOfCountry(db, host)))).flat()
    ),
  ];
  // Whether a map can be drawn at all, decided HERE because it chooses the page's
  // layout. `FrontLineMap` draws from two sources (region shards for a country
  // with states, a static shard for a proxy host) and a zone with neither renders
  // one sentence inside a 620px box while the whole record is squeezed into the
  // 452px rail beside it. DD is exactly that case.
  const hasMap = hostRegionCodes.length > 0 || staticZoneGeometry(hostEntities).codes.length > 0;

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
    const rdy = forceReadiness(own, viewerArrearsRatio, viewerReadinessTier);
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
    // The window actually drawn, which is the war's whole length until it is
    // older than MOMENTUM_WINDOW. The note quotes this so its ground figure is
    // never mistaken for the verdict's since-the-opening one.
    windowTurns: Math.max(1, currentTurn - fromTurn),
    unopposedAdvances: record.unopposedAdvances,
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
  const recovering = recoveringCount(ownAtFront, viewerArrearsRatio, viewerReadinessTier);
  if (recovering > 0) {
    pending.push({
      text: `${recovering} formation${recovering === 1 ? "" : "s"} recovering readiness`,
      when: `+${READINESS_DRIFT_STEP}%`,
      tone: "plain",
    });
  }
  if (pending.length === 0) {
    // No `when`: the chip's two halves were saying the same thing twice ("Nothing
    // of yours resolves at this front" · "the line holds"). A chip with nothing
    // pending has no timing to state.
    pending.push({
      text: canAct
        ? "No offensive declared — the line holds"
        : "Nothing of yours resolves at this front",
      when: "",
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

  const fogLiftsTurn = archiveOpensTurn(doc);
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
    // Only while the fog is still down on a resolved war: the panels use it to say
    // when the record opens, and an open record has nothing to announce.
    ...(tier !== "archive" && fogLiftsTurn !== null ? { archiveOpensTurn: fogLiftsTurn } : {}),
    // Only shown when the war was actually declared. warGoalLabel would otherwise
    // print "Undeclared" on every seeded or event-created conflict.
    ...(doc.warGoal ? { warGoal: warGoalLabel(doc.warGoal) } : {}),
    sideALabel: doc.sideA.label,
    sideBLabel: doc.sideB.label,
    sideACountries,
    sideBCountries,
    sideAFaction: doc.sideA.factionEntity,
    sideBFaction: doc.sideB.factionEntity,
    // Humanised here rather than in the component: the record is a presentational
    // client component and has no business reaching for country or org constants.
    //
    // Filtered to countries STILL on a roster. Entries are never deleted (they are the
    // war's record of why each ally came), so an ally released by its principal's peace
    // would otherwise keep claiming a place in a belligerent list it has left.
    treatyNotes: (doc.treatyEntries ?? [])
      .filter((e) => sideACountries.includes(e.countryId) || sideBCountries.includes(e.countryId))
      .map((e) => ({
        country: COUNTRY_CONFIGS[e.countryId]?.name ?? e.countryId,
        organization:
          INTERNATIONAL_ORGANIZATIONS[e.organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS]
            ?.name ?? e.organizationId,
        defending: COUNTRY_CONFIGS[e.defending]?.name ?? e.defending,
      })),
    control: doc.control,
    controlStart,
    hostEntities,
    hostRegionCodes,
    hasMap,
    belligerents: belligerentRoll(doc),
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
    // The record needs a party NAME and the term stores an id. Resolved from the
    // batch loaded above, so a war with several converting settlements is still one
    // query. Always keyed on `toCountry`: the term lands on the recipient whichever
    // side the deal removes from the war.
    settlements: settlements.map((o) =>
      settlementRow(
        o,
        o.term.kind === "regime_change" && o.term.rulingPartyId != null
          ? partyDisplayName(settlementParties.get(o.toCountry), o.term.rulingPartyId)
          : null
      )
    ),
    tier,
    canAct,
    viewerCountry,
    ownSide,
    // No character means no seat to describe — a logged-out reader of the public
    // record does not need to be told they hold none.
    chain: viewerCharacterId ? chain : null,
    actions,
    dictate,
    postedHere,
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
    navalAir: extras.navalAir,
    arrearsRatio: viewerArrearsRatio,
    readinessTier: viewerReadinessTier,
  };

  return <ConflictRecord conflict={conflict} />;
}
