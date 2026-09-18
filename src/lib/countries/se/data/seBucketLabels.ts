import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const SE_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Bakgrund",
    age: "Ålder",
    education: "Utbildning",
    income: "Inkomst",
    urbanization: "Var de bor",
  },
  buckets: {
    ethnicity: { swedish: "Svenskar", immigrant: "Utrikes födda", other: "Övriga" },
    age: { young: "Under 30", mid: "30–49 år", mature: "50–64 år", senior: "Över 65" },
    education: {
      primary_or_below: "Grundskola",
      secondary: "Gymnasium",
      vocational: "Yrkesutbildning",
      university: "Högskola",
    },
    income: { low: "Låg inkomst", middle: "Medelinkomst", high: "Hög inkomst" },
    urbanization: { urban: "Storstad", suburban: "Förort", rural: "Landsbygd" },
  },
};
