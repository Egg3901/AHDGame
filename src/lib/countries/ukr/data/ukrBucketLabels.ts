import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

// Ukraine. Same five dimensions as Byelorussia below, in Ukrainian. The
// ethnicity buckets follow the seed's own keys, which stay `ukrainian` /
// `russian` / `other` in both eras - the 1979 census's larger Russian share is
// a change in the numbers, not in the categories.
export const UKR_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Походження (Background)",
    age: "Вік (Age)",
    education: "Освіта (Education)",
    income: "Дохід (Income)",
    urbanization: "Де живуть (Where they live)",
  },
  buckets: {
    ethnicity: {
      ukrainian: "Українці (Ukrainians)",
      russian: "Росіяни (Russians)",
      other: "Інше походження (Other backgrounds)",
    },
    age: {
      young: "До 30 (Under 30)",
      mid: "30–49 років (30s and 40s)",
      mature: "50–64 роки (50s and 60s)",
      senior: "Понад 65 (Over 65)",
    },
    education: {
      primary_or_below: "Початкова освіта (Primary or below)",
      secondary: "Середня освіта (Secondary)",
      vocational: "Професійна освіта (Vocational)",
      university: "Вища освіта (University)",
    },
    income: {
      low: "Низький дохід (Lower income)",
      middle: "Середній дохід (Middle income)",
      high: "Високий дохід (Higher income)",
    },
    urbanization: {
      urban: "Міста (Cities)",
      suburban: "Передмістя (Suburbs)",
      rural: "Село (Rural)",
    },
  },
};
