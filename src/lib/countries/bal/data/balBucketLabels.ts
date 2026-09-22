import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";
import { AGE_EN, DIMS_EN, INCOME_EN, URBAN_EN } from "@/lib/demographics/bucketLabelScaffolding";

// The Baltic model spans three languages with no shared native form, so it
// takes English rather than arbitrarily picking one of them.
export const BAL_BUCKET_LABELS: CountryBucketLabels = {
  dims: DIMS_EN,
  buckets: {
    ethnicity: {
      baltic: "Baltic peoples",
      russian: "Russians",
      other: "Other backgrounds",
    },
    age: AGE_EN,
    education: {
      primary_or_below: "Primary or below",
      secondary: "Secondary",
      vocational: "Vocational",
      university: "University",
    },
    income: INCOME_EN,
    urbanization: URBAN_EN,
  },
};
