import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";
import { AGE_EN, DIMS_EN, INCOME_EN, URBAN_EN } from "@/lib/demographics/bucketLabelScaffolding";

export const UK_BUCKET_LABELS: CountryBucketLabels = {
  dims: DIMS_EN,
  buckets: {
    ethnicity: {
      white_british: "White British",
      asian_british: "Asian British",
      black_british: "Black British",
      mixed: "Mixed heritage",
      other: "Other backgrounds",
    },
    age: AGE_EN,
    education: {
      no_qualifications: "No qualifications",
      gcse_equivalent: "GCSEs",
      a_level_equivalent: "A-levels",
      degree_plus: "Degree or higher",
    },
    income: INCOME_EN,
    urbanization: URBAN_EN,
  },
};
