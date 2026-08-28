/**
 * Read-only live-data report for ticket 1065.
 *
 * Classifies each active bloc call, previews immediate treaty/principal entry,
 * and computes the pressure snapshot future offensive national bills receive.
 *
 *   npx tsx scripts/sim/blocWarEntryPolicy2026-08-28.ts
 */
import { MongoClient, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Bill } from "@/lib/db/types/legislation";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type {
  OrganizationLegislation,
  OrganizationMembership,
} from "@/lib/db/types/internationalOrganization";
import {
  assessWarEntryPoliticalPressure,
  classifyWarEntry,
  warEntryIsImmediate,
} from "@/lib/military/warEntryPolicy";
import type { CountryId } from "@/lib/constants/countries";

dotenv.config({
  path: [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../../.env.local"),
  ],
});
const configuredUri = process.env.MONGODB_URI_LIVE ?? process.env.MONGODB_URI;
if (!configuredUri) throw new Error("MONGODB_URI_LIVE or MONGODB_URI is required");
const uri = /directConnection=/.test(configuredUri)
  ? configuredUri
  : `${configuredUri}${configuredUri.includes("?") ? "&" : "?"}directConnection=true`;

function tally(bill: Bill | undefined): string {
  if (!bill) return "none";
  const lower = `${bill.votesFor}-${bill.votesAgainst}-${bill.votesAbstain}`;
  const upper = bill.otherChamberVotes
    ? ` / ${bill.otherChamberVotesFor ?? 0}-${bill.otherChamberVotesAgainst ?? 0}-${bill.otherChamberVotesAbstain ?? 0}`
    : "";
  return `${bill.status} ${lower}${upper}`;
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as Db;
    const [gameState, resolutions, memberships, bills] = await Promise.all([
      db.collection<{ _id: string; currentTurn?: number }>("gameState").findOne({ _id: "current" }),
      db
        .collection<OrganizationLegislation>("organizationLegislation")
        .find({ type: "join_conflict", status: "active" })
        .toArray(),
      db
        .collection<OrganizationMembership>("organizationMemberships")
        .find({ organizationId: { $in: ["NATO", "WARSAW_PACT"] } })
        .toArray(),
      db.collection<Bill>("bills").find({ "provisions.type": "join_conflict" }).toArray(),
    ]);
    const currentTurn = gameState?.currentTurn ?? 0;
    console.log(`# Bloc war-entry policy report, turn ${currentTurn}`);
    for (const resolution of resolutions) {
      const conflictId = resolution.joinConflictTheaterId;
      const side = resolution.joinConflictSide;
      if (!conflictId || !side) continue;
      const conflict = await db.collection<ConflictDoc>("conflicts").findOne({ _id: conflictId });
      if (!conflict) continue;
      console.log(`\n## ${resolution.organizationId}: ${conflict.name}`);
      console.log("\n| Country | Stakes | Path | Pressure | Existing bill |");
      console.log("| --- | --- | --- | ---: | --- |");
      const members = memberships
        .filter((row) => row.organizationId === resolution.organizationId)
        .map((row) => row.countryId as CountryId)
        .sort();
      for (const countryId of members) {
        const stake = classifyWarEntry({
          conflict,
          countryId,
          side,
          organizationId: resolution.organizationId,
        });
        const pressure = warEntryIsImmediate(stake)
          ? null
          : await assessWarEntryPoliticalPressure({
              db,
              countryId,
              organizationId: resolution.organizationId,
              stake,
              currentTurn,
            });
        const bill = bills.find(
          (candidate) =>
            candidate.countryId === countryId &&
            candidate.provisions?.some(
              (provision) =>
                provision.type === "join_conflict" &&
                provision.resolutionId === resolution._id.toString()
            )
        );
        console.log(
          `| ${countryId} | ${stake.replace(/_/g, " ")} | ${warEntryIsImmediate(stake) ? "immediate" : "national vote"} | ${pressure?.total ?? "n/a"} | ${tally(bill)} |`
        );
      }
    }

    const activeForeign = await db.collection<Bill>("bills").countDocuments({
      nppSponsored: true,
      category: "foreign policy",
      status: { $nin: ["failed", "withdrawn", "signed", "override_failed"] },
    });
    const activeDomestic = await db.collection<Bill>("bills").countDocuments({
      nppSponsored: true,
      category: { $ne: "foreign policy" },
      status: { $nin: ["failed", "withdrawn", "signed", "override_failed"] },
    });
    console.log("\n## Legislative capacity");
    console.log(
      `\nActive autonomous foreign-policy bills: ${activeForeign}. Active routine domestic bills: ${activeDomestic}. The ticket-1065 cap and cooldown count only the latter.`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
