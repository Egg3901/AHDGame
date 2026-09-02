/**
 * Ticket #1254 — "Corps split-off and double primary".
 *
 * DD ended reunification with TWO corporations flagged
 * `isPrimaryNationalCorporation`: the GDR's own sovereign issuer "East Germany"
 * (700…091, the canonical `DD_PUBLIC_CORPORATION_OID`) and the absorbed Federal
 * Republic's shell "Germany" (700…031), which kept its flag when its country
 * dissolved. DD is the only country in the world with two.
 *
 * Every resolver reads the primary with `findOne`, which returns whichever the
 * natural order yields — "Germany". That single fact produces all three
 * reported symptoms:
 *   - the State Enterprises panel renders two primaries (`isPrimary` is stamped
 *     per corp, so both claim it);
 *   - every merge defaults into "Germany" (`ensurePrimaryNationalCorporation`);
 *   - the split dropdown is empty, because `splittableSectorTypes` is computed
 *     from the sectors that wrong primary holds.
 *
 * It also stranded the state's finances. DD's SOE stack should be one
 * corporation per `CorporationType` — 17 — and only 7 exist. The other ten
 * types' 160 sectors fell through to the primary and landed on the FRG shell,
 * so "Germany" earns €6.6M/turn across 160 sectors it should not own while
 * "East Germany" carries €2.29B/turn of coupon service against zero income.
 * Both therefore remit nothing to the treasury.
 *
 * WHAT THIS DOES NOT DO. `upsertCountryOwnedCorpEntries` is the seeder's own
 * repair for precisely this shape, and its doc comment describes this world.
 * But it `$set`s seed data over every sector it touches, which would reset all
 * 262 live rows — including the 102 healthy ones — to seed values and discard
 * what the last turn computed. So this borrows the seed's CORPORATION documents
 * (canonical `0x1500`-band ids, sequential ids, names) and re-points the
 * existing sectors underneath them, leaving every sector's live state intact.
 *
 * Sectors are only ever moved OFF the one explicitly-named shell, never off any
 * other corporation, so this cannot take a sector from a player.
 *
 * Stages:
 *   --corps     create the missing per-type SOEs and re-point the 160 sectors
 *   --bonds     move the shell's sovereign bonds onto the real issuer
 *   --primary   clear the shell's primary flag, then dissolve it if empty
 *   --currency  DD corporations EUR -> DDM (at par, see fix-dd-currency.ts)
 *   --all       every stage, in that order
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient, ObjectId, type Db } from "mongodb";
import { config } from "dotenv";
import { generateCountryOwnedSeedData } from "@/lib/seeds/reference/budgets";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { commandEconomySoeSectors } from "@/lib/constants/commandEconomy";
import type { CountryId } from "@/lib/constants/countries";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const want = (f: string) => ALL || process.argv.includes(f);

const COUNTRY = "DD" as CountryId;
/** The absorbed Federal Republic's sovereign shell. */
const SHELL = new ObjectId("700000000000000000000031");
/** DD_PUBLIC_CORPORATION_OID — the canonical primary and sovereign issuer. */
const ISSUER = new ObjectId("700000000000000000000091");

async function seedEntriesFor(db: Db) {
  const preset = (await loadWorldPreset(db)) ?? "1953-default";
  const states = await db
    .collection("states")
    .find({ countryId: COUNTRY, _id: { $not: /^NATIONAL_/ } } as never)
    .project({ countryId: 1, population: 1, gdp: 1 })
    .toArray();
  const forSeed = states.map((s) => ({
    id: s._id as string,
    population: s.population as number,
    gdp: s.gdp as number,
    countryId: COUNTRY,
  }));
  const entries = generateCountryOwnedSeedData(forSeed, preset, true).filter(
    (e) => e.corporation.soe && e.corporation.countryOwnerId === COUNTRY && e.sectors.length > 0
  );
  return { preset, entries };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI_LIVE!, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  if (gs?.processingStartedAt) {
    throw new Error(`turn ${gs.currentTurn} is PROCESSING — refusing to write mid-turn`);
  }
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — turn ${gs?.currentTurn}\n`);

  const corps = db.collection("corporations");
  const sectors = db.collection("corporateSectors");

  const shell = await corps.findOne({ _id: SHELL } as never);
  const issuer = await corps.findOne({ _id: ISSUER } as never);
  if (!shell || !issuer) throw new Error("shell or issuer corporation missing — aborting");
  console.log(`shell : ${shell.name} (primary=${shell.isPrimaryNationalCorporation})`);
  console.log(`issuer: ${issuer.name} (primary=${issuer.isPrimaryNationalCorporation})\n`);

  // ── corps ────────────────────────────────────────────────────────────────
  if (want("--corps")) {
    const { preset, entries } = await seedEntriesFor(db);
    const wanted = commandEconomySoeSectors(COUNTRY);
    console.log(
      `[corps] preset=${preset}  SOE types required=${wanted.length}  seed entries=${entries.length}`
    );

    let created = 0;
    let repointed = 0;
    for (const entry of entries) {
      const type = entry.corporation.assignedSectorTypes?.[0] ?? entry.corporation.type;
      const canonicalId = entry.corporation._id as ObjectId;

      // Who owns this type today?
      const existing = await corps.findOne({
        countryOwnerId: COUNTRY,
        assignedSectorTypes: type,
        isPrimaryNationalCorporation: { $ne: true },
      } as never);

      // How many of this type sit on the shell right now?
      const onShell = await sectors.countDocuments({
        corporationId: SHELL,
        sectorType: type,
      } as never);
      if (!existing && onShell === 0) continue;

      let targetId: ObjectId;
      if (existing) {
        targetId = existing._id as ObjectId;
        if (onShell === 0) continue;
        console.log(
          `  ${String(type).padEnd(22)} -> existing ${existing.name}  (moving ${onShell})`
        );
      } else {
        // Never overwrite a canonical id that already belongs to someone else.
        const taken = await corps.findOne({ _id: canonicalId } as never);
        if (taken) {
          console.log(
            `  ${String(type).padEnd(22)} !! canonical id ${canonicalId} held by ${taken.name} — SKIPPED`
          );
          continue;
        }
        targetId = canonicalId;
        console.log(
          `  ${String(type).padEnd(22)} -> CREATE ${entry.corporation.name} (${canonicalId})  (moving ${onShell})`
        );
        if (APPLY) {
          const { _id, sequentialId: seedSeq, ...corpData } = entry.corporation;
          // The SOE sequential band (DD 900_300+) is already partly occupied by
          // corporations from an earlier seed layout, so the canonical number
          // can collide. `reconcileCommandEconomyUnowned` resolves this the same
          // way — take the next free number above the current maximum rather
          // than failing the run.
          let sequentialId = seedSeq;
          if (sequentialId != null) {
            const conflict = await corps.findOne({ sequentialId } as never, {
              projection: { _id: 1 },
            });
            if (conflict && !(conflict._id as ObjectId).equals(canonicalId)) {
              const [maxRow] = await corps
                .find({ sequentialId: { $type: "number" } } as never)
                .project({ sequentialId: 1 })
                .sort({ sequentialId: -1 })
                .limit(1)
                .toArray();
              sequentialId = Number(maxRow?.sequentialId ?? sequentialId) + 1;
              console.log(`      sequentialId ${seedSeq} taken -> ${sequentialId}`);
            }
          }
          await corps.updateOne(
            { _id: canonicalId } as never,
            { $set: { ...corpData, ...(sequentialId != null ? { sequentialId } : {}) } } as never,
            { upsert: true }
          );
        }
        created++;
      }

      if (APPLY) {
        const moved = await sectors.updateMany(
          { corporationId: SHELL, sectorType: type } as never,
          { $set: { corporationId: targetId, updatedAt: new Date() } } as never
        );
        repointed += moved.modifiedCount ?? 0;
      } else {
        repointed += onShell;
      }
    }
    console.log(`[corps] SOEs created=${created}  sectors re-pointed=${repointed}`);
  }

  // ── bonds ────────────────────────────────────────────────────────────────
  if (want("--bonds")) {
    const n = await db.collection("bonds").countDocuments({ corporationId: SHELL } as never);
    const already = await db.collection("bonds").countDocuments({ corporationId: ISSUER } as never);
    console.log(`\n[bonds] on shell=${n}  already on issuer=${already}`);
    if (APPLY && n > 0) {
      const r = await db.collection("bonds").updateMany(
        { corporationId: SHELL } as never,
        {
          $set: { corporationId: ISSUER, issuerName: issuer.name, updatedAt: new Date() },
        } as never
      );
      console.log(`[bonds] moved ${r.modifiedCount}`);
    }
  }

  // ── primary ──────────────────────────────────────────────────────────────
  if (want("--primary")) {
    const remainingSectors = await sectors.countDocuments({ corporationId: SHELL } as never);
    const remainingBonds = await db
      .collection("bonds")
      .countDocuments({ corporationId: SHELL } as never);
    const liquid = Number(shell.liquidCapital ?? 0);
    console.log(
      `\n[primary] shell holds sectors=${remainingSectors} bonds=${remainingBonds} liquidCapital=${liquid}`
    );

    // A dissolving National Corporation's cash belongs to the state, not to
    // nowhere. `mergeBackSectorType` is money-neutral for the same reason: a
    // NatCorp has no private shareholders, so the balance simply follows the
    // sectors onto the surviving corporation. Only ever at matching currency —
    // adding across denominations would silently mis-state the treasury.
    if (liquid !== 0) {
      const shellCur = shell.liquidCurrencyCode ?? null;
      const issuerCur = issuer.liquidCurrencyCode ?? null;
      if (shellCur !== issuerCur) {
        throw new Error(
          `refusing to transfer liquidCapital: shell is ${shellCur}, issuer is ${issuerCur} — convert first`
        );
      }
      console.log(
        `[primary] transferring ${liquid.toLocaleString()} ${shellCur} to ${issuer.name}` +
          ` (${Number(issuer.liquidCapital ?? 0).toLocaleString()} -> ${(Number(issuer.liquidCapital ?? 0) + liquid).toLocaleString()})`
      );
      if (APPLY) {
        await corps.updateOne(
          { _id: ISSUER } as never,
          {
            $inc: { liquidCapital: liquid },
            $set: { updatedAt: new Date() },
          } as never
        );
        await corps.updateOne(
          { _id: SHELL } as never,
          {
            $set: { liquidCapital: 0, updatedAt: new Date() },
          } as never
        );
      }
    }

    if (APPLY) {
      await corps.updateOne(
        { _id: SHELL } as never,
        {
          $set: { isPrimaryNationalCorporation: false, updatedAt: new Date() },
        } as never
      );
      await corps.updateOne(
        { _id: ISSUER } as never,
        {
          $set: { isPrimaryNationalCorporation: true, updatedAt: new Date() },
        } as never
      );
      const stillHas = await sectors.countDocuments({ corporationId: SHELL } as never);
      const stillOwes = await db
        .collection("bonds")
        .countDocuments({ corporationId: SHELL } as never);
      if (stillHas === 0 && stillOwes === 0) {
        await corps.deleteOne({ _id: SHELL } as never);
        console.log("[primary] shell dissolved (held nothing)");
      } else {
        console.log("[primary] shell NOT dissolved — still holds something; flag cleared only");
      }
    }
    const primaries = await corps.countDocuments({
      countryOwnerId: COUNTRY,
      isPrimaryNationalCorporation: true,
    } as never);
    console.log(
      `[primary] primaries for ${COUNTRY} now: ${primaries}${APPLY ? "" : " (unchanged, dry run)"}`
    );
  }

  // ── currency ─────────────────────────────────────────────────────────────
  if (want("--currency")) {
    const n = await corps.countDocuments({
      $or: [{ countryId: COUNTRY }, { countryOwnerId: COUNTRY }],
      liquidCurrencyCode: "EUR",
    } as never);
    console.log(`\n[currency] DD corporations holding EUR: ${n}`);
    if (APPLY && n > 0) {
      const r = await corps.updateMany(
        {
          $or: [{ countryId: COUNTRY }, { countryOwnerId: COUNTRY }],
          liquidCurrencyCode: "EUR",
        } as never,
        { $set: { liquidCurrencyCode: "DDM", updatedAt: new Date() } } as never
      );
      console.log(`[currency] modified ${r.modifiedCount}`);
    }
  }

  console.log(APPLY ? "\nAPPLIED" : "\nDRY RUN — nothing written.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
