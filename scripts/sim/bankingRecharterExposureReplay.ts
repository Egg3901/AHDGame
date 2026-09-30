/** Isolated continuation of the completed browser world; no balance repair or live writes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { MongoClient, type Db } from "mongodb";
import { BANK, BORROWER, advanceJourney, journeySnapshot } from "./bankingJourneyFixture";
import { issueCharter, revokeCharter } from "@/lib/banking/charter";
import { originateLoan } from "@/lib/banking/lending";

const arg = (key: string) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
async function book(db: Db) {
  const [corp, loans] = await Promise.all([
    db.collection("corporations").findOne({ _id: BANK }),
    db
      .collection("bankLoans")
      .find({ bankCorporationId: BANK, status: { $in: ["current", "arrears"] } })
      .toArray(),
  ]);
  return {
    counter: Number(corp?.bankCharter?.totalLoans ?? 0),
    principal: loans.reduce((sum, loan) => sum + loan.outstanding, 0),
    namedPrincipal: loans
      .filter((loan) => loan.borrowerType !== "npcBulk")
      .reduce((sum, loan) => sum + loan.outstanding, 0),
    npcPrincipal: loans
      .filter((loan) => loan.borrowerType === "npcBulk")
      .reduce((sum, loan) => sum + loan.outstanding, 0),
  };
}
const near = (actual: number, expected: number, label: string) =>
  assert(Math.abs(actual - expected) < 0.02, `${label}: ${actual} != ${expected}`);

async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    source = arg("source"),
    target = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(source && target && out && source !== target);
  assert([source, target].every((name) => /^ahd_sim_[a-zA-Z0-9_-]+$/.test(name)));
  assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: uri,
    MONGODB_DB: target,
    MONGO_DB_NAME: target,
  });
  const client = await MongoClient.connect(uri);
  global._mongoClientPromise = Promise.resolve(client);
  try {
    const sourceDb = client.db(source),
      db = client.db(target);
    assert.equal((await db.listCollections().toArray()).length, 0, "Target must be new");
    const sourceHash = createHash("sha256");
    const counts: Record<string, number> = {};
    const names = (await sourceDb.listCollections({}, { nameOnly: true }).toArray())
      .map((row) => row.name)
      .sort();
    for (const name of names) {
      const documents = await sourceDb.collection(name).find({}).sort({ _id: 1 }).toArray();
      counts[name] = documents.length;
      sourceHash.update(name).update(JSON.stringify(documents));
      if (documents.length) await db.collection(name).insertMany(documents);
    }
    const copiedSourceHash = sourceHash.digest("hex");
    const before = await journeySnapshot(db),
      inheritedBook = await book(db);
    assert.equal(before.turn, 568, "Continue the completed browser world");
    const revoked = await revokeCharter(
      db,
      BANK,
      "Synthetic saved-world recharter exposure qualification"
    );
    assert(revoked.ok);
    const afterRevoke = await journeySnapshot(db);
    near(afterRevoke.cash, before.cash, "revocation conserves existing cash");
    const treasuryBefore = Number(
      (await db.collection("corporations").findOne({ _id: BANK }))?.liquidCapital
    );
    const attempts = await Promise.all([
      issueCharter(db, BANK, "retail", "USD"),
      issueCharter(db, BANK, "retail", "USD"),
    ]);
    assert.equal(
      attempts.filter((result) => result.ok).length,
      1,
      "Competing reissues fund only one charter"
    );
    const issued = attempts.find((result) => result.ok);
    assert(issued?.ok);
    const afterIssue = await journeySnapshot(db),
      reissuedBook = await book(db);
    near(
      reissuedBook.counter,
      reissuedBook.principal,
      "all surviving exposure present at publication"
    );
    near(afterIssue.cash, afterRevoke.cash, "reissue conserves cash");
    const treasuryAfter = Number(
      (await db.collection("corporations").findOne({ _id: BANK }))?.liquidCapital
    );
    near(treasuryBefore - treasuryAfter, issued.postedCapital, "capital debited only once");
    const loan = await originateLoan(db, BANK, { type: "corporation", id: BORROWER }, 1000, 12);
    assert(loan.ok, loan.ok ? "" : loan.error);
    assert(!loan.pending);
    const afterOrigination = await journeySnapshot(db),
      originatedBook = await book(db);
    near(
      originatedBook.counter,
      originatedBook.principal,
      "new origination adds to surviving exposure"
    );
    near(originatedBook.principal - reissuedBook.principal, 1000, "one funded loan");
    near(afterOrigination.cash, afterIssue.cash, "loan cash conservation");
    const game = await db.collection("gameState").findOne({ _id: "current" as never });
    assert(game);
    const phases = await advanceJourney(db, game.currentTurn + 1, game.currentYear);
    const afterTurn = await journeySnapshot(db),
      servicedBook = await book(db);
    near(
      servicedBook.counter,
      servicedBook.principal,
      "named servicing plus resized NPC book counted once"
    );
    near(
      afterTurn.cash - afterOrigination.cash,
      afterTurn.mint - afterOrigination.mint - (afterTurn.burn - afterOrigination.burn),
      "turn cash conservation"
    );
    assert(
      afterTurn.journals.every(
        (move) =>
          move.status === "applied" ||
          (move.status === "rejected" &&
            move.amounts.every((leg: { applied: boolean }) => !leg.applied))
      )
    );
    const verifyHash = createHash("sha256");
    for (const name of names)
      verifyHash
        .update(name)
        .update(
          JSON.stringify(await sourceDb.collection(name).find({}).sort({ _id: 1 }).toArray())
        );
    assert.equal(verifyHash.digest("hex"), copiedSourceHash, "Source browser world changed");
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit,
          copiedSourceHash,
          counts,
          inheritedBook,
          reissuedBook,
          originatedBook,
          servicedBook,
          postedCapital: issued.postedCapital,
          successfulReissues: 1,
          treasuryBefore,
          treasuryAfter,
          phases,
          cash: {
            before: before.cash,
            afterRevoke: afterRevoke.cash,
            afterIssue: afterIssue.cash,
            afterOrigination: afterOrigination.cash,
            afterTurn: afterTurn.cash,
          },
          turns: [before.turn, afterTurn.turn],
          appliedJournals: afterTurn.journals.filter((move) => move.status === "applied").length,
          rejectedWithoutMoney: afterTurn.journals.filter((move) => move.status === "rejected")
            .length,
        },
        null,
        2
      )
    );
    console.log("recharter exposure, origination and servicing qualification passed");
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
