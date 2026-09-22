import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const IT_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Origine",
    age: "Età",
    education: "Istruzione",
    income: "Reddito",
    urbanization: "Dove vivono",
  },
  buckets: {
    ethnicity: { italian: "Italiani", immigrant: "Immigrati", other: "Altre origini" },
    age: {
      young: "Sotto i 30",
      mid: "30-49 anni",
      mature: "50-64 anni",
      senior: "Over 65",
    },
    education: {
      primary_or_below: "Licenza elementare",
      secondary: "Diploma",
      vocational: "Formazione professionale",
      university: "Laurea",
    },
    income: { low: "Redditi bassi", middle: "Redditi medi", high: "Redditi alti" },
    urbanization: { urban: "Città", suburban: "Periferie", rural: "Aree rurali" },
  },
};
