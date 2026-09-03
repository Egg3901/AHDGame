/* READ ONLY. Everything the DE->DD reversal would have to touch on the live world. */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const line = (s: string) => console.log(s);

  line("=== shells ===");
  for (const cc of ["DE", "DD"]) {
    const gs = await db.collection("countryGameStates").findOne({ _id: cc as never });
    const cs = await db.collection("countryState").findOne({ _id: cc as never });
    line(
      `${cc}: enabled=${gs?.enabledForPlayers} status=${gs?.status} dissolvedTurn=${gs?.dissolvedTurn ?? "-"}`
    );
    line(
      `    govType=${cs?.governmentType ?? "-"} rulingPartyId=${cs?.rulingPartyId ?? "-"} ` +
        `nameOverride=${cs?.displayNameOverride ?? "-"} flagOverride=${cs?.flagEmojiOverride ?? "-"}`
    );
  }

  line("\n=== per-country row counts ===");
  const colls = [
    "states",
    "politicalParties",
    "characters",
    "electedOfficials",
    "cabinetMembers",
    "governmentFormations",
    "militaryUnits",
    "federalBudget",
    "bills",
    "tariffs",
    "npps",
    "organizationMemberships",
    "countryLeaderStates",
    "legislationTypes",
  ];
  for (const c of colls) {
    const key = c === "federalBudget" || c === "governmentFormations" ? "_id" : "countryId";
    const de = await db.collection(c).countDocuments({ [key]: "DE" } as never);
    const dd = await db.collection(c).countDocuments({ [key]: "DD" } as never);
    line(`  ${c.padEnd(26)} DE=${String(de).padEnd(6)} DD=${dd}`);
  }

  line("\n=== regions ===");
  const regions = await db
    .collection("states")
    .find({ countryId: { $in: ["DE", "DD"] } })
    .project({ _id: 1, countryId: 1, name: 1, population: 1 })
    .toArray();
  line(
    `  ${regions.length} region(s): ${regions.map((r) => `${r._id}(${r.countryId})`).join(" ")}`
  );

  line("\n=== parties under DE (post-merge numbering) ===");
  const parties = await db
    .collection("politicalParties")
    .find({ countryId: "DE" })
    .project({ sequentialId: 1, name: 1, regimeStatus: 1, mergedFrom: 1 })
    .sort({ sequentialId: 1 })
    .toArray();
  for (const p of parties) {
    const mf = p.mergedFrom as { countryId?: string; sequentialId?: number } | undefined;
    line(
      `  #${String(p.sequentialId).padEnd(3)} ${String(p.name).padEnd(34)} ` +
        `${String(p.regimeStatus ?? "-").padEnd(9)} ${mf ? `<- ${mf.countryId}#${mf.sequentialId}` : "(native DE)"}`
    );
  }

  line("\n=== fisc stamps ===");
  for (const cc of ["DE", "DD"]) {
    const b = await db.collection("federalBudget").findOne({ _id: cc as never });
    if (!b) {
      line(`  ${cc}: no federalBudget row`);
      continue;
    }
    const ef = (b.economicFactors ?? {}) as Record<string, unknown>;
    line(
      `  ${cc}: mergedInto=${b.mergedInto ?? "-"} treasury=${b.treasuryBalance ?? "-"} ` +
        `ceiling=${(b.debt as Record<string, unknown>)?.ceiling ?? "-"} ` +
        `marketization=${ef.marketizationLevel ?? "-"}`
    );
  }

  line("\n=== the crisis + war ===");
  const crisis = await db.collection("settlementCrises").findOne({ status: "resolved" });
  line(
    `  crisis ${String(crisis?._id)} outcome=${crisis?.outcome} resolvedTurn=${crisis?.resolvedTurn} ` +
      `completed=${crisis?.actuationCompletedTurn ?? "-"} cooldownUntil=${crisis?.cooldownUntilTurn ?? "-"}`
  );
  const conflict = await db.collection("conflicts").findOne({ _id: "war_us_dd_415" as never });
  line(
    `  war status=${conflict?.status} victor=${conflict?.victor ?? "-"} endTurn=${conflict?.endTurn ?? "-"}`
  );

  line("\n=== players who chose each Germany ===");
  for (const cc of ["DE", "DD"]) {
    const n = await db
      .collection("characters")
      .countDocuments({ countryId: cc, userId: { $ne: null } } as never);
    line(`  ${cc}: ${n} character(s) with a userId`);
  }

  const gameState = await db.collection("gameState").findOne({ _id: "current" as never });
  line(`\ncurrent turn: ${gameState?.currentTurn ?? "?"}  preset: ${gameState?.preset ?? "?"}`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
