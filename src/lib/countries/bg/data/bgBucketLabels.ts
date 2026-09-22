import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const BG_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Произход (Background)",
    age: "Възраст (Age)",
    education: "Образование (Education)",
    income: "Доход (Income)",
    urbanization: "Местоживеене (Where they live)",
  },
  buckets: {
    ethnicity: {
      bulgarian: "Българи (Bulgarians)",
      turkish: "Турци (Turks)",
      other: "Друг произход (Other backgrounds)",
    },
    age: {
      young: "Под 30 (Under 30)",
      mid: "30–49 години (30s and 40s)",
      mature: "50–64 години (50s and 60s)",
      senior: "Над 65 (Over 65)",
    },
    education: {
      primary_or_below: "Основно образование (Primary or below)",
      secondary: "Средно образование (Secondary)",
      vocational: "Професионално образование (Vocational)",
      university: "Висше образование (University)",
    },
    income: {
      low: "Нисък доход (Lower income)",
      middle: "Среден доход (Middle income)",
      high: "Висок доход (Higher income)",
    },
    urbanization: {
      urban: "Градове (Cities)",
      suburban: "Предградия (Suburbs)",
      rural: "Село (Rural)",
    },
  },
};
