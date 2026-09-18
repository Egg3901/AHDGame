import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const RO_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Origine",
    age: "Vârstă",
    education: "Educație",
    income: "Venit",
    urbanization: "Unde locuiesc",
  },
  buckets: {
    ethnicity: { romanian: "Români", hungarian: "Maghiari", other: "Alte origini" },
    age: { young: "Sub 30", mid: "30–49 ani", mature: "50–64 ani", senior: "Peste 65" },
    education: {
      primary_or_below: "Școala primară",
      secondary: "Liceu",
      vocational: "Școală profesională",
      university: "Studii superioare",
    },
    income: { low: "Venituri mici", middle: "Venituri medii", high: "Venituri mari" },
    urbanization: { urban: "Orașe", suburban: "Periferii", rural: "Sate" },
  },
};
