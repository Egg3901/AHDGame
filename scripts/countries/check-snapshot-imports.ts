/**
 * Does every registry the snapshot emitter imports actually RESOLVE?
 *
 * ⚠ THIS EXISTS BECAUSE AN UNEXPORTED REGISTRY SNAPSHOTS AS "absent", NOT AS AN
 * ERROR. `EXECUTIVE_TEXT` in `constants/institutionIdentity.ts` is declared
 * `const`, not `export const`. The emitter imports it anyway, gets `undefined`,
 * and the shape-driven extractor files it under `absent` -- the same word it
 * uses for a country that genuinely has no entry in a registry. The two cases
 * are indistinguishable in the fixture, and "absent" is the one an operator is
 * primed to wave through.
 *
 * So the pre-move record, which is the ONLY independent evidence of what a value
 * was before the move, can silently record nothing at all for a registry that is
 * full of data. A folder built from it would simply lack that field, and the
 * faithful-replacement harness would agree, because it compares against the same
 * empty fixture.
 *
 * Run this BEFORE trusting a snapshot. It reports `undefined` bindings, which is
 * a broken import, separately from empty ones.
 *
 *   npx tsx scripts/countries/check-snapshot-imports.ts
 */
import { readFileSync } from "node:fs";

const EMITTER = "scripts/countries/emit-country-snapshot.ts";

async function main() {
  const src = readFileSync(EMITTER, "utf8");

  // The REGISTRIES map is the emitter's own list, so this cannot drift from it.
  const block = src.slice(src.indexOf("const REGISTRIES"));
  const names = [...block.matchAll(/^ {2}([A-Z][A-Z0-9_]+),\s*$/gm)].map((m) => m[1]);
  if (names.length === 0) throw new Error("could not read REGISTRIES from " + EMITTER);

  // Import the emitter's own module graph by re-importing each source module.
  const imports = [...src.matchAll(/^import\s*\{([^}]+)\}\s*from\s*"([^"]+)";/gm)];
  const binding = new Map<string, string>();
  for (const [, clause, from] of imports) {
    for (const raw of clause.split(",")) {
      const sym = raw
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (sym) binding.set(sym, from);
    }
  }

  const missing: string[] = [];
  const empty: string[] = [];
  let ok = 0;

  for (const name of names) {
    const from = binding.get(name);
    if (!from) {
      missing.push(`${name} -- not imported by ${EMITTER}`);
      continue;
    }
    const mod = (await import(from)) as Record<string, unknown>;
    const value = mod[name];
    if (value === undefined) {
      missing.push(`${name} -- imports as undefined from ${from} (declared without \`export\`?)`);
    } else if (typeof value === "object" && value !== null && Object.keys(value).length === 0) {
      empty.push(`${name} -- resolves, but is empty`);
    } else {
      ok++;
    }
  }

  console.log(`${names.length} registries in ${EMITTER}`);
  console.log(`  resolve with contents : ${ok}`);
  console.log(`  resolve but empty     : ${empty.length}`);
  console.log(`  UNDEFINED             : ${missing.length}`);
  for (const m of empty) console.log("  warn  " + m);
  for (const m of missing) console.log("  FAIL  " + m);

  if (missing.length) {
    console.log(
      "\nAn undefined binding is NOT the same as a country having no entry, but the\n" +
        "snapshot records both as `absent`. Fix the import or the export before\n" +
        "emitting a snapshot, or the fixture will claim the registry held nothing."
    );
    process.exit(1);
  }
}

void main();
