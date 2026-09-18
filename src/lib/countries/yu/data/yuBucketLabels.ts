import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

// Serbo-Croatian in Latin script, as Yugoslavia itself used alongside Cyrillic.
export const YU_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Porijeklo",
    age: "Dob",
    education: "Obrazovanje",
    income: "Prihod",
    urbanization: "Gdje žive",
  },
  buckets: {
    ethnicity: { south_slav: "Južni Slaveni", albanian: "Albanci", other: "Ostalo porijeklo" },
    age: {
      young: "Ispod 30",
      mid: "30–49 godina",
      mature: "50–64 godine",
      senior: "Iznad 65",
    },
    education: {
      primary_or_below: "Osnovna škola",
      secondary: "Srednja škola",
      vocational: "Stručna škola",
      university: "Visoko obrazovanje",
    },
    income: { low: "Niski prihodi", middle: "Srednji prihodi", high: "Visoki prihodi" },
    urbanization: { urban: "Gradovi", suburban: "Predgrađa", rural: "Selo" },
  },
};
