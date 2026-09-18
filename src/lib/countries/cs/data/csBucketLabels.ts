import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const CS_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Původ",
    age: "Věk",
    education: "Vzdělání",
    income: "Příjem",
    urbanization: "Kde žijí",
  },
  buckets: {
    ethnicity: { czech: "Češi", slovak: "Slováci", other: "Jiný původ" },
    age: { young: "Do 30", mid: "30–49 let", mature: "50–64 let", senior: "Nad 65" },
    education: {
      primary_or_below: "Základní škola",
      secondary: "Střední škola",
      vocational: "Učňovské",
      university: "Vysoká škola",
    },
    income: { low: "Nízké příjmy", middle: "Střední příjmy", high: "Vysoké příjmy" },
    urbanization: { urban: "Města", suburban: "Předměstí", rural: "Venkov" },
  },
};
