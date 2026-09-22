import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const TR_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Köken",
    age: "Yaş",
    education: "Eğitim",
    income: "Gelir",
    urbanization: "Yaşadıkları yer",
  },
  buckets: {
    ethnicity: { turkish: "Türkler", kurdish: "Kürtler", other: "Diğer kökenler" },
    age: { young: "30 yaş altı", mid: "30–49 yaş", mature: "50–64 yaş", senior: "65 yaş üstü" },
    education: {
      primary_or_below: "İlkokul ve altı",
      secondary: "Lise",
      vocational: "Meslek okulu",
      university: "Üniversite",
    },
    income: { low: "Düşük gelir", middle: "Orta gelir", high: "Yüksek gelir" },
    // "Banliyö", not the colloquial "varoş", which is pejorative.
    urbanization: { urban: "Şehirler", suburban: "Banliyö", rural: "Kırsal" },
  },
};
