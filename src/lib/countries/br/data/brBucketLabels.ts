import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const BR_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Origem",
    age: "Idade",
    education: "Escolaridade",
    income: "Renda",
    urbanization: "Onde vivem",
  },
  buckets: {
    ethnicity: {
      branco: "Brancos",
      pardo: "Pardos",
      preto: "Pretos",
      amarelo: "Amarelos",
      indigena: "Indígenas",
    },
    age: {
      young: "Menores de 30",
      mid: "30 a 49 anos",
      mature: "50 a 64 anos",
      senior: "Acima de 65",
    },
    education: {
      fundamental: "Ensino fundamental",
      medio: "Ensino médio",
      superior: "Ensino superior",
    },
    income: { low: "Baixa renda", middle: "Renda média", high: "Alta renda" },
    urbanization: { urban: "Cidades", suburban: "Periferia", rural: "Zona rural" },
  },
};
