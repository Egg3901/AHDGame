import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const PL_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Pochodzenie",
    age: "Wiek",
    education: "Wykształcenie",
    income: "Dochód",
    urbanization: "Miejsce zamieszkania",
  },
  buckets: {
    ethnicity: { polish: "Polacy", minority: "Mniejszości", other: "Inne pochodzenie" },
    age: { young: "Poniżej 30", mid: "30–49 lat", mature: "50–64 lata", senior: "Powyżej 65" },
    education: {
      primary_or_below: "Podstawowe",
      secondary: "Średnie",
      vocational: "Zawodowe",
      university: "Wyższe",
    },
    income: { low: "Niskie dochody", middle: "Średnie dochody", high: "Wysokie dochody" },
    urbanization: { urban: "Miasta", suburban: "Przedmieścia", rural: "Wieś" },
  },
};
