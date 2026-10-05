import assert from "node:assert/strict";
import { AT_GEOGRAPHY } from "../../src/lib/countries/at/geography";
import { atRegions } from "../../src/lib/countries/at/data/atRegions";
import { CN_GEOGRAPHY } from "../../src/lib/countries/cn/geography";
import { cnRegions2027 } from "../../src/lib/countries/cn/data/cnRegions2027";
import { ES_GEOGRAPHY } from "../../src/lib/countries/es/geography";
import { esRegions } from "../../src/lib/countries/es/data/esRegions";
import { FI_GEOGRAPHY } from "../../src/lib/countries/fi/geography";
import { fiRegions } from "../../src/lib/countries/fi/data/fiRegions";
import { FR_GEOGRAPHY } from "../../src/lib/countries/fr/geography";
import { frRegions } from "../../src/lib/countries/fr/data/frRegions";
import { GR_GEOGRAPHY } from "../../src/lib/countries/gr/geography";
import { grRegions } from "../../src/lib/countries/gr/data/grRegions";
import { IE_GEOGRAPHY } from "../../src/lib/countries/ie/geography";
import { ieRegions2023 } from "../../src/lib/countries/ie/data/ieRegions2023";
import { IT_GEOGRAPHY } from "../../src/lib/countries/it/geography";
import { itRegions } from "../../src/lib/countries/it/data/itRegions";
import { NG_GEOGRAPHY } from "../../src/lib/countries/ng/geography";
import { ngRegions2023 } from "../../src/lib/countries/ng/data/ngRegions2023";
import { SE_GEOGRAPHY } from "../../src/lib/countries/se/geography";
import { seRegions } from "../../src/lib/countries/se/data/seRegions";
import { getNationalBudgetSeedConfigsForPreset } from "../../src/lib/seeds/reference/budgets";
import { selectPresetBundle } from "../../src/lib/seeds/presetSelector";

const rows = [
  {
    country: "IE",
    geography: IE_GEOGRAPHY,
    regionalShareSource: "IE 2023 bundle",
    raw: ieRegions2023,
  },
  {
    country: "CN",
    geography: CN_GEOGRAPHY,
    regionalShareSource: "CN 2027 bundle",
    raw: cnRegions2027,
  },
  {
    country: "NG",
    geography: NG_GEOGRAPHY,
    regionalShareSource: "NG 2023 bundle",
    raw: ngRegions2023,
  },
  {
    country: "FR",
    geography: FR_GEOGRAPHY,
    regionalShareSource: "existing FR bundle",
    raw: frRegions,
  },
  {
    country: "IT",
    geography: IT_GEOGRAPHY,
    regionalShareSource: "existing IT bundle",
    raw: itRegions,
  },
  {
    country: "ES",
    geography: ES_GEOGRAPHY,
    regionalShareSource: "existing ES bundle",
    raw: esRegions,
  },
  {
    country: "SE",
    geography: SE_GEOGRAPHY,
    regionalShareSource: "existing SE bundle",
    raw: seRegions,
  },
  {
    country: "GR",
    geography: GR_GEOGRAPHY,
    regionalShareSource: "existing GR bundle",
    raw: grRegions,
  },
  {
    country: "AT",
    geography: AT_GEOGRAPHY,
    regionalShareSource: "existing AT bundle",
    raw: atRegions,
  },
  {
    country: "FI",
    geography: FI_GEOGRAPHY,
    regionalShareSource: "existing FI bundle",
    raw: fiRegions,
  },
] as const;

const budgets = getNationalBudgetSeedConfigsForPreset("2027-default");
console.log(
  "country,share_source,regions,before_population,fiscal_anchor,after_population,max_region_rounding_error"
);
for (const row of rows) {
  const selected = selectPresetBundle(
    "2027-default",
    row.geography.regionBundles,
    `issue2325:${row.country}`
  );
  const before = row.raw.reduce((sum, region) => sum + region.population, 0);
  const anchor = budgets.find((budget) => budget.countryId === row.country)?.population;
  assert(
    anchor && Number.isSafeInteger(anchor),
    `${row.country} lacks a 2027 fiscal population anchor`
  );
  assert.equal(
    selected.reduce((sum, region) => sum + region.population, 0),
    anchor,
    `${row.country} 2027 sum`
  );
  assert.deepEqual(
    selected.map((region) => region._id),
    row.raw.map((region) => region._id)
  );
  const maxRoundingError = Math.max(
    ...selected.map((region, index) =>
      Math.abs(region.population - (row.raw[index].population / before) * anchor)
    )
  );
  assert(maxRoundingError < 1.01, `${row.country} regional shares changed beyond integer rounding`);
  console.log(
    `${row.country},${row.regionalShareSource},${selected.length},${before},${anchor},${selected.reduce((sum, region) => sum + region.population, 0)},${maxRoundingError.toFixed(3)}`
  );
}
