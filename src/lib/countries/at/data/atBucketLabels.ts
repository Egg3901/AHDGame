import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";
import { AGE_DE, DIMS_DE, INCOME_DE } from "@/lib/demographics/bucketLabelScaffolding";

export const AT_BUCKET_LABELS: CountryBucketLabels = {
  dims: DIMS_DE,
  buckets: {
    ethnicity: { austrian: "Österreicher", minority: "Minderheiten", other: "Andere Herkunft" },
    age: AGE_DE,
    education: {
      primary_or_below: "Pflichtschule",
      secondary: "Matura",
      vocational: "Lehre",
      university: "Hochschulabschluss",
    },
    income: INCOME_DE,
    urbanization: { urban: "Stadt", suburban: "Umland", rural: "Ländlicher Raum" },
  },
};
