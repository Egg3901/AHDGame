/**
 * Put back the Federal Republic's enacted laws that I deleted.
 *
 * WHY THIS EXISTS. I removed all 36 of them to stop a double-count, on the
 * reasoning that the GDR's statute book was the one that survived. That was too
 * blunt: the double-count only ever existed where the two sides OVERLAPPED, and
 * at least one FRG programme had no GDR counterpart at all. `transport` was
 * West-only — East Germany spent nothing on it at the last pre-merge gate and the
 * Federal Republic spent 12.7bn — so deleting `de_rail_transport` left the
 * unified state with no transport policy whatsoever.
 *
 * NOT GUESSWORK. The rows are rebuilt from data that still exists rather than
 * invented: the catalogue holds every type and its policy options, the option is
 * recoverable from the law's title (a default reads `<type name> (Default)`, a
 * passed act reads `<option name> — <type name>`), and all 33 FRG bills survive.
 * The script REFUSES to write any row whose option it cannot match, rather than
 * substituting a plausible one.
 *
 * `enactedLaws` was not in the pre-reversal backup, which is the reason this had
 * to be reconstructed at all instead of restored.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient, ObjectId } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const TO = "DD";

/** The seeded statutory defaults: one per type, titled `<type name> (Default)`. */
const DEFAULTS = [
  "de_income_tax_rate",
  "de_vat_rate",
  "de_domestic_corporate_tax_rate",
  "de_foreign_corporate_tax_rate",
  "de_customs_tariff_rate",
  "de_immigration_policy",
  "de_health_insurance",
  "de_elder_care",
  "de_public_health",
  "de_education_funding",
  "de_university_tuition",
  "de_research_science",
  "de_unemployment_welfare",
  "de_foreign_aid_diplomacy",
  "de_policing_public_safety",
  "de_criminal_justice",
  "de_constitutional_protection",
  "de_fiscal_stimulus_act",
  "de_sme_mittelstand",
  "de_rail_transport",
  "de_housing",
  "de_asylum_policy",
  "de_agricultural_subsidies",
  "de_food_security",
  "de_animal_welfare",
  "de_public_broadcasting",
];

/**
 * The statutory rates the FRG's five tax acts stood at, read off the rows before
 * they were deleted. Tax types name their options by RATE ("19%", "45%"), not
 * after the act, so a name match cannot resolve them — and substituting a
 * plausible rate would quietly rewrite the country's tax code.
 */
const DEFAULT_TAX_RATES: Record<string, number> = {
  de_income_tax_rate: 45,
  de_vat_rate: 19,
  de_domestic_corporate_tax_rate: 18,
  de_foreign_corporate_tax_rate: 18,
  de_customs_tariff_rate: 5,
};

/**
 * The budget category each type booked against, read off the rows before deletion.
 *
 * NOT derived: `legislationTypes` carries no `budgetCategory` at all, so deriving
 * it lands every tax act in "other" and silently moves the country's tax revenue
 * out of the tax line. The category decides which bucket a law charges, so a
 * wrong one is not cosmetic.
 */
const CATEGORY: Record<string, string> = {
  de_income_tax_rate: "tax",
  de_vat_rate: "tax",
  de_domestic_corporate_tax_rate: "tax",
  de_foreign_corporate_tax_rate: "tax",
  de_customs_tariff_rate: "tax",
  de_immigration_policy: "welfare",
  de_unemployment_welfare: "welfare",
  de_asylum_policy: "welfare",
  de_health_insurance: "healthcare",
  de_elder_care: "healthcare",
  de_public_health: "healthcare",
  de_education_funding: "education",
  de_university_tuition: "education",
  de_research_science: "education",
  de_academic_reform: "education",
  de_policing_public_safety: "defense",
  de_criminal_justice: "defense",
  de_constitutional_protection: "defense",
  de_wehrpflicht: "defense",
  de_rail_transport: "transport",
  de_electoral_reform: "governance",
  de_foreign_aid_diplomacy: "other",
  de_fiscal_stimulus_act: "other",
  de_sme_mittelstand: "other",
  de_housing: "other",
  de_agricultural_subsidies: "other",
  de_food_security: "other",
  de_animal_welfare: "other",
  de_public_broadcasting: "other",
};

/** The acts players actually passed: option name, its type, and the surviving bill. */
const PASSED: Array<{ option: string; type: string; bill: string }> = [
  {
    option: "Bauernhilfen Investment Act",
    type: "de_agricultural_subsidies",
    bill: "6a7b8d6199b159cfd5186233",
  },
  { option: "Elder Care Investment Act", type: "de_elder_care", bill: "6a7b8d6199b159cfd5186234" },
  { option: "4%", type: "de_customs_tariff_rate", bill: "6a80e17e4d2a9525a34b222e" },
  {
    option: "Voluntary Service Year Expansion Act",
    type: "de_wehrpflicht",
    bill: "6a89d5b1b72c24d290e19196",
  },
  {
    option: "Academic Excellence Promotion Act",
    type: "de_academic_reform",
    bill: "6a8b3548e6e42acf40b6613e",
  },
  {
    option: "Livestock Liberalization Act",
    type: "de_animal_welfare",
    bill: "6a8bcff7f191a4c98d2aacbd",
  },
  { option: "6%", type: "de_customs_tariff_rate", bill: "6a8c94d52e5d0e0b1cf2c41f" },
  {
    option: "Majoritarian Reform Act",
    type: "de_electoral_reform",
    bill: "6a8d2f803a25fcb9956afb65",
  },
  { option: "20%", type: "de_vat_rate", bill: "6a8d92199fd0a700efccc368" },
  { option: "12%", type: "de_domestic_corporate_tax_rate", bill: "6a8e8f3d72a64be7ecea0150" },
];

interface TypeDoc {
  _id: string;
  name?: string;
  budgetCategory?: string;
  policyDomain?: string;
  policyOptions?: Array<{ id?: string; name?: string; budgetCategory?: string; rate?: number }>;
}

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  const turn = Number(gs?.currentTurn ?? 0);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — turn ${turn}\n`);

  const ids = [...new Set([...DEFAULTS, ...PASSED.map((p) => p.type)])];
  const types = (await db
    .collection("legislationTypes")
    .find({ _id: { $in: ids } } as never)
    .toArray()) as unknown as TypeDoc[];
  const byId = new Map(types.map((t) => [String(t._id), t]));

  const existing = await db
    .collection("enactedLaws")
    .countDocuments({ countryId: TO, legislationTypeId: { $regex: "^de[_.]" } } as never);
  console.log(`FRG enacted laws currently present: ${existing}`);
  if (existing > 0) {
    console.log("already restored — nothing to do");
    await client.close();
    return;
  }

  const rows: Record<string, unknown>[] = [];
  const unresolved: string[] = [];

  const optionIndex = (t: TypeDoc, wanted: string): number => {
    const opts = t.policyOptions ?? [];
    // A default enactment uses the option carrying the type's own name.
    const exact = opts.findIndex((o) => String(o.name ?? "").trim() === wanted.trim());
    if (exact >= 0) return exact;
    const starts = opts.findIndex((o) =>
      String(o.name ?? "")
        .trim()
        .startsWith(wanted.trim())
    );
    return starts;
  };

  for (const id of DEFAULTS) {
    const t = byId.get(id);
    if (!t) {
      unresolved.push(`${id} (type missing)`);
      continue;
    }
    if (!CATEGORY[id]) {
      unresolved.push(`${id} (no recorded budget category)`);
      continue;
    }
    const rate = DEFAULT_TAX_RATES[id];
    const idx =
      rate != null
        ? (t.policyOptions ?? []).findIndex((o) => Number(o.rate) === rate)
        : optionIndex(t, String(t.name ?? ""));
    if (idx < 0) {
      unresolved.push(
        rate != null ? `${id} (no option at rate ${rate}%)` : `${id} (no option named "${t.name}")`
      );
      continue;
    }
    rows.push({
      scope: "national",
      countryId: TO,
      legislationTypeId: id,
      budgetCategory: CATEGORY[id],
      budgetCost: 0,
      policyOptionIndex: idx,
      ...(rate != null ? { rate } : {}),
      title: `${t.name} (Default)`,
      enactedAt: new Date(),
      enactedYear: 1963,
    });
  }

  for (const p of PASSED) {
    const t = byId.get(p.type);
    if (!t) {
      unresolved.push(`${p.type} (type missing)`);
      continue;
    }
    if (!CATEGORY[p.type]) {
      unresolved.push(`${p.type} (no recorded budget category)`);
      continue;
    }
    const idx = optionIndex(t, p.option);
    if (idx < 0) {
      unresolved.push(`${p.type} (no option matching "${p.option}")`);
      continue;
    }
    rows.push({
      scope: "national",
      countryId: TO,
      legislationTypeId: p.type,
      billId: new ObjectId(p.bill),
      budgetCategory: CATEGORY[p.type],
      budgetCost: 0,
      policyOptionIndex: idx,
      ...(t.policyOptions?.[idx]?.rate != null ? { rate: Number(t.policyOptions[idx].rate) } : {}),
      title: `${t.policyOptions?.[idx]?.name} — ${t.name}`,
      enactedAt: new Date(),
      enactedYear: 1963,
    });
  }

  console.log(`rebuilt ${rows.length} row(s); unresolved ${unresolved.length}`);
  for (const u of unresolved) console.log(`  !! ${u}`);
  if (unresolved.length > 0) {
    throw new Error("refusing to write a partial restore — every option must resolve");
  }
  for (const r of rows) {
    console.log(
      `  ${String(r.legislationTypeId).padEnd(32)} opt=${String(r.policyOptionIndex).padEnd(3)} ${String(r.budgetCategory).padEnd(14)} ${String(r.title).slice(0, 46)}`
    );
  }

  if (APPLY) {
    await db.collection("enactedLaws").insertMany(rows as never);
    console.log(`\nAPPLIED — ${rows.length} law(s) restored.`);
  } else {
    console.log("\nDRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
