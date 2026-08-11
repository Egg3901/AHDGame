require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  // The "Sector not found" error in buyListedSector.ts:106 comes from:
  //   .findOne({ _id: new ObjectId(sectorId), corporationId: seller._id })
  // where seller is resolved from the URL [id] param via resolveCorporation().
  //
  // The sector detail GET uses the EXACT same query pattern.
  // So if GET succeeds but POST fails, the data changed between requests
  // OR the URL param resolved differently.
  //
  // Let's check for the specific scenarios:

  console.log("=== Scenario 1: Stale listing / race condition ===");
  console.log("If someone bought the sector between page load and click,");
  console.log("the sector's corporationId would have changed.");
  console.log("All 16 listed sectors are currently valid (no orphans found).");
  console.log("This is the most likely cause if the error is intermittent.");

  console.log("\n=== Scenario 2: Data inconsistency ===");
  // Check if any sector's corporationId points to a corp with a different
  // sequentialId than what the URL might use
  const listedSectors = await db
    .collection("corporateSectors")
    .find({ forSale: { $ne: null } })
    .toArray();

  for (const s of listedSectors) {
    const corp = await db.collection("corporations").findOne({ _id: s.corporationId });
    if (!corp) continue;

    // If the sector detail page is accessed via /corporation/<sequentialId>/sector/<sectorId>
    // and the sector's corporationId matches that corp, everything is fine.
    // But what if the sector was created for corp A, then corp A was deleted/recreated
    // and the sequentialId now belongs to corp B?
    // In that case, resolveCorporation(db, sequentialId) would return corp B,
    // but the sector's corporationId still points to corp A (which no longer exists
    // or has a different sequentialId).

    // Check: does the corp's sequentialId resolve back to the same corp?
    if (corp.sequentialId != null) {
      const bySeq = await db
        .collection("corporations")
        .findOne({ sequentialId: corp.sequentialId });
      if (bySeq && !bySeq._id.equals(corp._id)) {
        console.log(
          "DATA INCONSISTENCY: sequentialId",
          corp.sequentialId,
          "resolves to",
          bySeq.name,
          "but sector",
          s._id.toString(),
          "belongs to",
          corp.name
        );
      }
    }
  }
  console.log("No sequentialId collisions found.");

  console.log("\n=== Scenario 3: URL param mismatch ===");
  console.log("The frontend uses different link patterns:");
  console.log("- SectorRow.tsx: /corporation/${corpId}/sector/${sector._id}");
  console.log("  (corpId is passed from parent, uses whatever the page loaded)");
  console.log(
    "- StateEconomy.tsx: /corporation/${owner.corporationSequentialId ?? owner.corporationId}/sector/${owner.sectorId}"
  );
  console.log("  (uses sequentialId if available)");
  console.log(
    "- sectors/page.tsx: /corporation/${sector.corporationSequentialId ?? sector.corporationId}"
  );
  console.log("  (uses sequentialId if available)");
  console.log("- sector detail page: /corporation/${corporation.sequentialId ?? corporation._id}");
  console.log("  (uses sequentialId if available)");
  console.log("");
  console.log("The buy endpoint uses the SAME URL param as the detail page.");
  console.log("So if the detail page loads, the buy endpoint should resolve the same corp.");
  console.log("UNLESS: the user manually changes the URL or bookmarks an old URL.");

  console.log("\n=== Scenario 4: The sector was unlisted between GET and POST ===");
  console.log("The buy endpoint checks: if (!sector.forSale) return 400");
  console.log(
    'This would return "Sector is not currently listed for sale", NOT "Sector not found"'
  );
  console.log("So this is NOT the cause of the 404.");

  console.log("\n=== Scenario 5: The sector was bought by someone else between GET and POST ===");
  console.log("If another buyer purchased the sector:");
  console.log("- The sector's corporationId changed to the new buyer");
  console.log("- The forSale field was unset");
  console.log("- The buy endpoint query { _id: sectorId, corporationId: seller._id } would miss");
  console.log('- Returns 404 "Sector not found"');
  console.log("This is the MOST LIKELY cause.");

  console.log("\n=== Recommendation ===");
  console.log("The 404 is likely a race condition: another buyer purchased the sector");
  console.log("between the detail page load and the buy button click.");
  console.log("");
  console.log("To confirm, add temporary logging to buyListedSector.ts:104-107:");
  console.log(
    '  console.log("Buy attempt: sectorId=" + sectorId + " sellerId=" + seller._id.toString());'
  );
  console.log('  const sector = await db.collection<CorporateSector>("corporateSectors")');
  console.log("    .findOne({ _id: new ObjectId(sectorId), corporationId: seller._id });");
  console.log("  if (!sector) {");
  console.log("    // Log the actual sector state for diagnosis");
  console.log('    const anySector = await db.collection<CorporateSector>("corporateSectors")');
  console.log("      .findOne({ _id: new ObjectId(sectorId) });");
  console.log(
    '    console.log("Sector not found. Sector exists under corpId:", anySector?.corporationId?.toString());'
  );
  console.log('    return NextResponse.json({ error: "Sector not found" }, { status: 404 });');
  console.log("  }");

  // Check if there are any sectors that were recently transferred
  // (updatedAt significantly after listedAt)
  console.log("\n=== Recently transferred sectors ===");
  for (const s of listedSectors) {
    const listedAt = s.forSale?.listedAt ? new Date(s.forSale.listedAt) : null;
    const updatedAt = s.updatedAt ? new Date(s.updatedAt) : null;
    if (listedAt && updatedAt && updatedAt.getTime() > listedAt.getTime() + 5 * 60 * 1000) {
      const corp = await db.collection("corporations").findOne({ _id: s.corporationId });
      console.log(
        "Sector",
        s._id.toString(),
        "was updated",
        updatedAt.toISOString(),
        "after being listed",
        listedAt.toISOString(),
        "- corp:",
        corp?.name
      );
    }
  }

  await client.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
