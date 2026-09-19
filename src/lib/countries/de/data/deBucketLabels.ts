import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";
import { AGE_DE, DIMS_DE, INCOME_DE } from "@/lib/demographics/bucketLabelScaffolding";

export const DE_BUCKET_LABELS: CountryBucketLabels = {
  dims: DIMS_DE,
  buckets: {
    ethnicity: {
      german: "Deutsche",
      turkish_russian_diaspora: "Türkische und russische Community",
      mena: "Nahost und Nordafrika",
      eu_southern_eastern: "Süd- und Osteuropa",
      other: "Andere Herkunft",
    },
    age: AGE_DE,
    education: {
      no_degree: "Ohne Abschluss",
      berufsausbildung: "Berufsausbildung",
      abitur: "Abitur",
      hochschulabschluss: "Hochschulabschluss",
    },
    income: INCOME_DE,
    urbanization: { urban: "Großstadt", suburban: "Umland", rural: "Ländlicher Raum" },
  },
};
