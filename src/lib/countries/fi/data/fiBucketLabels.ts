import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const FI_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Tausta",
    age: "Ikä",
    education: "Koulutus",
    income: "Tulot",
    urbanization: "Asuinpaikka",
  },
  buckets: {
    ethnicity: { finnish: "Suomalaiset", minority: "Vähemmistöt", other: "Muut taustat" },
    age: { young: "Alle 30", mid: "30–49 v", mature: "50–64 v", senior: "Yli 65" },
    education: {
      primary_or_below: "Peruskoulu",
      secondary: "Lukio",
      vocational: "Ammatillinen koulutus",
      university: "Korkeakoulu",
    },
    income: { low: "Pienituloiset", middle: "Keskituloiset", high: "Suurituloiset" },
    urbanization: { urban: "Kaupungit", suburban: "Lähiöt", rural: "Maaseutu" },
  },
};
