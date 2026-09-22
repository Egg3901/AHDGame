import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const ES_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Origen",
    age: "Edad",
    education: "Estudios",
    income: "Renta",
    urbanization: "Dónde viven",
  },
  buckets: {
    ethnicity: {
      spanish: "Españoles",
      regional: "Nacionalidades históricas",
      other: "Otros orígenes",
    },
    age: {
      young: "Menores de 30",
      mid: "30 a 49 años",
      mature: "50 a 64 años",
      senior: "Mayores de 65",
    },
    education: {
      primary_or_below: "Sin estudios",
      secondary: "Bachillerato",
      vocational: "Formación profesional",
      university: "Estudios universitarios",
    },
    income: { low: "Rentas bajas", middle: "Rentas medias", high: "Rentas altas" },
    urbanization: { urban: "Ciudades", suburban: "Extrarradio", rural: "España rural" },
  },
};
