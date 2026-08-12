/**
 * End-to-end verification of the Cold War conflict lifecycle (PR1–PR4).
 *
 * Drives the REAL production code paths against the TESTING database
 * (`MONGODB_URI` — the Atlas cluster, never `MONGODB_URI_LIVE`), walking the
 * plan's manual checklist:
 *
 *   1. create a `cold_war` conflict over the two Vietnams
 *   2. table a NATO Join Conflict resolution and let the org phase pass it
 *   3. confirm a mirrored bill opens in BOTH chambers of a member's legislature
 *   4. pass it and confirm the country is enrolled WITHOUT reaching the President
 *   5. declare an offensive and confirm `control` MOVES (not a walkover)
 *   6. push to a pole and confirm the hold is stamped, not resolved
 *   7. run three turns and confirm the war resolves, the hosts join the winner's
 *      bloc, and their alignment shifts
 *
 * Everything it writes is namespaced under a run id and removed at the end, so a
 * failed run leaves no fixture behind.
 *
 * Run: npx tsx scripts/verify-cold-war-lifecycle.ts
 */
import { MongoClient, ObjectId, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const RUN = `cwverify-${Date.now()}`;
const THEATER = `${RUN}-vietnam`;

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  checks++;
  if (ok) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failures++;
  console.log(`  FAIL  ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (uri === process.env.MONGODB_URI_LIVE) throw new Error("refusing to run against LIVE");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db() as unknown as Db;
  console.log(`Connected to the testing cluster. Run id: ${RUN}\n`);

  // Imported lazily so dotenv is applied before any module reads the env.
  const { getConflictsCollection } = await import("@/lib/db/collections/conflicts");
  const { resolveBattleDeclarations } = await import("@/lib/turn/battleResolution");
  const { resolveColdWarHolds } = await import("@/lib/turn/coldWarHolds");
  const { buildJoinConflictBill } =
    await import("@/lib/internationalOrganizations/commands/buildJoinConflictBill");
  const { applyLegislationEffect } = await import("@/lib/legislationEffects");
  const { billRequiresExecutiveAction } =
    await import("@/lib/internationalOrganizations/withdrawalBills");
  const { canEnterTheatre } = await import("@/lib/military/rosterGate");
  const { sideOf } = await import("@/lib/military/occupation");
  const { belligerentSideOf } = await import("@/lib/military/conflictVisibility");

  const gameState = await db.collection("gameState").findOne({ _id: "current" as never });
  const currentTurn = (gameState?.currentTurn as number) ?? 1000;
  console.log(`gameState.currentTurn = ${currentTurn}, preset = ${gameState?.preset}\n`);

  // ⚠️ Snapshot the alignment rows BEFORE anything runs. Resolving the fixture war
  // swings the hosts toward the winner, and these rows are PRE-EXISTING state that
  // no cleanup could otherwise put back — the first version of this script left the
  // testing database permanently 5 points more Western for both Vietnams.
  const alignmentBefore = await db
    .collection("countryAlignments")
    .find({ entityId: { $in: ["NVN", "SVN"] } } as never)
    .toArray();

  const conflicts = getConflictsCollection(db);

  // ── 1. A cold_war conflict over the two Vietnams ──────────────────────────
  console.log("1. Create the proxy war");
  await conflicts.insertOne({
    _id: THEATER,
    conflictId: 999000 + (Date.now() % 1000),
    name: `${RUN} Vietnam War`,
    type: "cold_war",
    status: "active",
    hostCountry: "SVN",
    hostEntities: ["NVN", "SVN"],
    region: "sea",
    terrain: "Jungle / delta",
    bloc: "contested",
    severity: "HIGH",
    baseStrength: 300,
    terr: 1.1,
    infra: 20,
    enemyMix: ["infantry", "mech"],
    sideA: {
      label: "Republic of Vietnam",
      countries: [],
      kind: "generated",
      backer: "west",
      factionEntity: "SVN",
      tokenStrength: 40,
    },
    sideB: {
      label: "DRV",
      countries: [],
      kind: "generated",
      backer: "east",
      factionEntity: "NVN",
      tokenStrength: 40,
    },
    supplyA: 60,
    supplyB: 60,
    supplyBaseA: 60,
    supplyBaseB: 60,
    control: 50,
    controlStart: 50,
    startTurn: currentTurn,
    createdBy: "event",
  } as never);
  const created = await conflicts.findOne({ _id: THEATER });
  check("conflict created as cold_war", created?.type === "cold_war");

  // ── 2. The placement chain (PR4 Task 1's hard gate) ───────────────────────
  console.log("\n2. Placement resolvers");
  check("belligerentSideOf places the faction", belligerentSideOf(created!, "NVN") === "B");
  check("sideOf places the faction", sideOf(created!, "NVN", {}) === "B");
  check("sideOf still refuses a bystander", sideOf(created!, "LAO", {}) === null);

  // ── 3. The roster gate (PR4 Task 2) ───────────────────────────────────────
  console.log("\n3. Roster gate");
  check("a non-belligerent bloc member is refused", canEnterTheatre("US", created!) === false);

  // ── 4. The mirrored bill (PR2 + PR3) ──────────────────────────────────────
  console.log("\n4. Mirrored bill");
  const sponsor = { characterId: new ObjectId(), characterName: `${RUN} Head of Government` };
  const provision = {
    type: "join_conflict" as const,
    theaterId: THEATER,
    side: "A" as const,
    organizationId: "NATO",
    resolutionId: new ObjectId().toString(),
  };
  const billId = await buildJoinConflictBill({
    db,
    countryId: "US",
    preset: (gameState?.preset as string) ?? "1953-default",
    sponsor,
    conflictName: "Vietnam War",
    organizationId: "NATO",
    provision,
  });
  const bill = await db.collection("bills").findOne({ _id: billId });
  check("bill opens at active_both", bill?.status === "active_both");
  check(
    "both deadline pairs are stamped",
    bill?.votingEndsOnTurn != null && bill?.otherChamberVotingEndsOnTurn != null
  );
  check("both vote maps exist", bill?.votes != null && bill?.otherChamberVotes != null);
  check("filed at the US national id", bill?.stateId === "federal");
  check("skips the President", billRequiresExecutiveAction(bill as never) === false);

  // ── 5. Enactment enrols the country ───────────────────────────────────────
  console.log("\n5. Enactment");
  await applyLegislationEffect(db, bill as never);
  const afterJoin = await conflicts.findOne({ _id: THEATER });
  check("the US is enrolled on side A", (afterJoin?.sideA.countries as string[]).includes("US"));
  check(
    "the faction is NOT in the roster",
    !(afterJoin?.sideB.countries as string[]).includes("NVN")
  );
  check("now admitted to the theatre", canEnterTheatre("US", afterJoin!) === true);

  // ── 6. A battle that actually moves control (the hard gate) ───────────────
  console.log("\n6. Battle");
  const unitId = new ObjectId();
  await db.collection("militaryUnits").insertOne({
    _id: unitId,
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: `${RUN} Division`,
    type: "Armored Division",
    icon: "tank",
    basePower: 4000,
    personnel: 15000,
    upkeepBase: 180,
    posture: "standard",
    techTier: 3,
    vet: 2,
    xp: 0,
    readiness: 90,
    equipment: { firepower: 3, protection: 3, support: 3 },
    drill: null,
    theaterId: THEATER,
    assignedGeneralId: null,
    createdTurn: currentTurn,
  } as never);
  const declId = new ObjectId();
  await db.collection("battleDeclarations").insertOne({
    _id: declId,
    declarerCountry: "US",
    targetCountry: "NVN",
    theaterId: THEATER,
    declaredByCharacterId: null,
    declaredTurn: currentTurn,
    status: "pending",
  } as never);

  const controlBefore = (await conflicts.findOne({ _id: THEATER }))!.control;
  await resolveBattleDeclarations(db, currentTurn + 1);
  const afterBattle = await conflicts.findOne({ _id: THEATER });
  check("control MOVED", afterBattle!.control !== controlBefore, {
    before: controlBefore,
    after: afterBattle!.control,
  });

  const report = await db.collection("battleReports").findOne({ theaterId: THEATER });
  check("a real battle was fought, not a walkover", report != null && !report.noContact);
  check("the faction's token force took losses", (afterBattle!.sideB.tokenStrength ?? 40) < 40, {
    tokenStrength: afterBattle!.sideB.tokenStrength,
  });
  const factionUnits = await db.collection("militaryUnits").countDocuments({ countryId: "NVN" });
  check("no militaryUnits row was written for the faction", factionUnits === 0);

  // ── 7. Pole stamp, not resolution ─────────────────────────────────────────
  console.log("\n7. Pole hold");
  await conflicts.updateOne({ _id: THEATER }, { $set: { control: 0.5 } });
  await db.collection("battleDeclarations").insertOne({
    _id: new ObjectId(),
    declarerCountry: "US",
    targetCountry: "NVN",
    theaterId: THEATER,
    declaredByCharacterId: null,
    declaredTurn: currentTurn + 1,
    status: "pending",
  } as never);
  await resolveBattleDeclarations(db, currentTurn + 2);
  const atPole = await conflicts.findOne({ _id: THEATER });
  check("reached side A's pole", atPole!.control === 0, { control: atPole!.control });
  check("the hold is STAMPED", atPole!.poleSide === "A" && atPole!.poleSinceTurn != null, {
    poleSide: atPole!.poleSide,
    poleSinceTurn: atPole!.poleSinceTurn,
  });
  check("the war has NOT resolved yet", atPole!.status !== "resolved");

  // ── 8. Three turns later it resolves and the hosts change bloc ────────────
  console.log("\n8. Resolution");
  const holdTurn = atPole!.poleSinceTurn as number;
  const early = await resolveColdWarHolds(db, holdTurn + 2);
  check("does NOT resolve at two turns", early.resolved === 0);

  const late = await resolveColdWarHolds(db, holdTurn + 3);
  check("resolves at three turns", late.resolved === 1);
  const resolved = await conflicts.findOne({ _id: THEATER });
  check("status is resolved", resolved!.status === "resolved");
  check("outcome names side A", resolved!.outcome?.winner === "A");
  check(
    "the note lists BOTH hosts",
    /NVN[\s\S]*SVN|SVN[\s\S]*NVN/.test(resolved!.outcome?.note ?? ""),
    {
      note: resolved!.outcome?.note,
    }
  );

  const memberships = await db
    .collection("organizationMemberships")
    .find({ countryId: { $in: ["NVN", "SVN"] }, organizationId: "NATO" })
    .toArray();
  check("both hosts joined NATO", memberships.length === 2, {
    found: memberships.map((m) => m.countryId),
  });

  if (gameState?.intOrgAlignmentEnabled === true) {
    const after = await db
      .collection("countryAlignments")
      .find({ entityId: { $in: ["NVN", "SVN"] } } as never)
      .toArray();
    const byId = new Map(alignmentBefore.map((r) => [r.entityId as string, r]));
    const swung = after.filter((row) => {
      const prior = byId.get(row.entityId as string);
      if (!prior) return false;
      const was = (prior.shares as Record<string, number>).WEST ?? 0;
      const now = (row.shares as Record<string, number>).WEST ?? 0;
      return now > was;
    });
    check("both hosts swung toward the winning bloc", swung.length === 2, {
      swung: swung.map((r) => r.entityId),
    });
    const sums = after.map(
      (r) =>
        Object.values(r.shares as Record<string, number>).reduce((a, b) => a + b, 0) +
        (r.nonAligned as number)
    );
    check(
      "shares still total 100",
      sums.every((s) => s === 100),
      { sums }
    );
  } else {
    console.log("  SKIP  alignment shift — intOrgAlignmentEnabled is off in this world");
  }

  // ── cleanup ───────────────────────────────────────────────────────────────
  console.log("\nCleaning up");
  await conflicts.deleteOne({ _id: THEATER });
  await db.collection("bills").deleteOne({ _id: billId });
  await db.collection("militaryUnits").deleteMany({ theaterId: THEATER });
  await db.collection("battleDeclarations").deleteMany({ theaterId: THEATER });
  await db.collection("battleReports").deleteMany({ theaterId: THEATER });
  await db
    .collection("organizationMemberships")
    .deleteMany({ countryId: { $in: ["NVN", "SVN"] }, organizationId: "NATO" });
  await db.collection("notifications").deleteMany({ "metadata.billId": billId.toString() });
  // Put the pre-existing alignment rows back exactly as they were. These are the
  // only documents this script MUTATES rather than creates, so they are the only
  // ones a delete cannot undo.
  for (const row of alignmentBefore) {
    await db
      .collection("countryAlignments")
      .updateOne(
        { _id: row._id },
        { $set: { shares: row.shares, nonAligned: row.nonAligned, previous: row.previous } }
      );
  }
  console.log(
    `Removed every fixture this run created; restored ${alignmentBefore.length} alignment row(s).`
  );

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  await client.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
