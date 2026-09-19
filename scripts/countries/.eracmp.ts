import { ERA_COUNTRY_CONFIG_OVERRIDES } from "@/lib/constants/countries";
import { CONVERTED } from "@/lib/countries/singleCountryData";

function canon(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      return Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((a, k) => {
          if (o[k] !== undefined) a[k] = walk(o[k]);
          return a;
        }, {});
    }
    return x;
  };
  return JSON.stringify(walk(v));
}

async function main() {
  const presets = Object.keys(ERA_COUNTRY_CONFIG_OVERRIDES);
  let same = 0;
  const diffs: string[] = [];
  const missing: string[] = [];

  for (const preset of presets) {
    const row = (ERA_COUNTRY_CONFIG_OVERRIDES as Record<string, Record<string, unknown>>)[preset];
    for (const cc of Object.keys(row ?? {})) {
      if (!(CONVERTED as readonly string[]).includes(cc)) {
        missing.push(`${preset}.${cc} (not a converted country)`);
        continue;
      }
      const mod = (await import(`../../src/lib/countries/${cc.toLowerCase()}/eras`)) as Record<
        string,
        unknown
      >;
      const eras = mod[`${cc}_ERAS`] as Record<string, { config?: unknown }> | undefined;
      const folder = eras?.[preset]?.config;
      if (folder === undefined) {
        missing.push(`${preset}.${cc} — folder has no eras[${preset}].config`);
        continue;
      }
      if (canon(folder) === canon(row[cc])) same++;
      else diffs.push(`${preset}.${cc}`);
    }
  }
  console.log("presets:", presets.length);
  console.log("identical  :", same);
  console.log("DIFFERENT  :", diffs.length, diffs.join(", "));
  console.log("no folder  :", missing.length, missing.join(", "));
}
void main();
