import type { CountryId } from "@/lib/constants/countries";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";
import { DE_IDENTITY } from "@/lib/countries/de/identity";
import { CN_IDENTITY } from "@/lib/countries/cn/identity";
import { IE_IDENTITY } from "@/lib/countries/ie/identity";
import { DD_IDENTITY } from "@/lib/countries/dd/identity";
import { BR_IDENTITY } from "@/lib/countries/br/identity";
import { SCO_IDENTITY } from "@/lib/countries/sco/identity";
import { WAL_IDENTITY } from "@/lib/countries/wal/identity";

export interface CensusLabelSet {
  cardTitles: {
    ethnicity: string;
    age: string;
    education: string;
    income: string;
    urbanization: string;
  };
  ethnicity: Record<string, string>;
  age: Record<string, string>;
  education: Record<string, string>;
  income: Record<string, string>;
  urbanization: Record<string, string>;
}

/**
 * Per-country display labels for the archetype-style Layer-1 census cards.
 * US is intentionally absent — it uses its own dedicated branch + labels
 * (race / education / wealth / age / ideology) in the tab component.
 *
 * Income uses era-neutral tiers (Lower/Middle/Upper) because thresholds drift
 * between the 1991 and 2019 presets.
 */
// Shared by the UK and the seceded nations (SCO/WAL), which reuse the UK census
// categories and group keys.
/**
 * The United Kingdom's census labels, forwarded to its country folder.
 *
 * ⚠️ THE CONST FORWARDS, NOT JUST THE `UK:` KEY, BECAUSE THREE COUNTRIES SHARE
 * IT. Scotland and Wales reuse the UK label set -- `SCO` and `WAL` point at this
 * same value. Repointing only `UK:` at the folder would have left the seceded
 * nations reading the old literal, and the two would have drifted the first time
 * anyone edited a label. One definition, three keys.
 */

export const REGION_CENSUS_LABELS: Partial<Record<CountryId, CensusLabelSet>> = {
  UK: UK_IDENTITY.regionCensusLabels,
  SCO: SCO_IDENTITY.regionCensusLabels,
  WAL: WAL_IDENTITY.regionCensusLabels,
  JP: JP_IDENTITY.regionCensusLabels,
  DE: DE_IDENTITY.regionCensusLabels,
  IE: IE_IDENTITY.regionCensusLabels,
  CN: CN_IDENTITY.regionCensusLabels,
  BR: BR_IDENTITY.regionCensusLabels,
  DD: DD_IDENTITY.regionCensusLabels,
};
