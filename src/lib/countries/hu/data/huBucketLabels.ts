import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const HU_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Származás",
    age: "Életkor",
    education: "Végzettség",
    income: "Jövedelem",
    urbanization: "Lakóhely",
  },
  buckets: {
    ethnicity: { hungarian: "Magyarok", minority: "Kisebbségek", other: "Egyéb származás" },
    age: { young: "30 alatt", mid: "30–49 év", mature: "50–64 év", senior: "65 felett" },
    education: {
      primary_or_below: "Általános iskola",
      secondary: "Középiskola",
      vocational: "Szakképzés",
      university: "Felsőfokú",
    },
    income: {
      low: "Alacsony jövedelem",
      middle: "Közepes jövedelem",
      high: "Magas jövedelem",
    },
    urbanization: { urban: "Városok", suburban: "Elővárosok", rural: "Vidék" },
  },
};
