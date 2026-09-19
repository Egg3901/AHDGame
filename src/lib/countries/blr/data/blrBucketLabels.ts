import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const BLR_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Паходжанне (Background)",
    age: "Узрост (Age)",
    education: "Адукацыя (Education)",
    income: "Даход (Income)",
    urbanization: "Дзе жывуць (Where they live)",
  },
  buckets: {
    ethnicity: {
      belarusian: "Беларусы (Belarusians)",
      russian: "Рускія (Russians)",
      other: "Іншае паходжанне (Other backgrounds)",
    },
    age: {
      young: "Да 30 (Under 30)",
      mid: "30–49 гадоў (30s and 40s)",
      mature: "50–64 гады (50s and 60s)",
      senior: "Звыш 65 (Over 65)",
    },
    education: {
      primary_or_below: "Пачатковая адукацыя (Primary or below)",
      secondary: "Сярэдняя адукацыя (Secondary)",
      vocational: "Прафесійная адукацыя (Vocational)",
      university: "Вышэйшая адукацыя (University)",
    },
    income: {
      low: "Нізкі даход (Lower income)",
      middle: "Сярэдні даход (Middle income)",
      high: "Высокі даход (Higher income)",
    },
    urbanization: {
      urban: "Гарады (Cities)",
      suburban: "Прыгарады (Suburbs)",
      rural: "Вёска (Rural)",
    },
  },
};
