import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";
import { AGE_EN, DIMS_EN, INCOME_EN, URBAN_EN } from "@/lib/demographics/bucketLabelScaffolding";

export const IE_BUCKET_LABELS: CountryBucketLabels = {
  dims: DIMS_EN,
  buckets: {
    ethnicity: {
      irish: "Irish",
      uk_british: "British",
      eu_other: "Other EU",
      rest_of_world: "Rest of the world",
    },
    age: AGE_EN,
    education: {
      primary_or_less: "Primary or less",
      leaving_cert: "Leaving Certificate",
      post_secondary: "Post-Leaving Cert",
      third_level: "Third level",
    },
    income: INCOME_EN,
    urbanization: URBAN_EN,
  },
};
