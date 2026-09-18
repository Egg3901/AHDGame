import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const RU_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Происхождение (Background)",
    age: "Возраст (Age)",
    education: "Образование (Education)",
    income: "Доход (Income)",
    urbanization: "Место жительства (Where they live)",
  },
  buckets: {
    ethnicity: {
      russian: "Русские (Russians)",
      ukrainian: "Украинцы (Ukrainians)",
      central_asian: "Народы Средней Азии (Central Asian)",
      caucasian: "Народы Кавказа (Caucasus peoples)",
      other: "Другие народы (Other peoples)",
    },
    age: {
      young: "До 30 лет (Under 30)",
      mid: "30–49 лет (30s and 40s)",
      mature: "50–64 года (50s and 60s)",
      senior: "Старше 65 (Over 65)",
    },
    education: {
      primary_or_below: "Начальное образование (Primary or below)",
      secondary: "Среднее образование (Secondary)",
      vocational: "Профессиональное образование (Vocational)",
      university: "Высшее образование (University)",
    },
    income: {
      low: "Низкий доход (Lower income)",
      middle: "Средний доход (Middle income)",
      high: "Высокий доход (Higher income)",
    },
    urbanization: {
      urban: "Города (Cities)",
      suburban: "Пригороды (Suburbs)",
      rural: "Село (Rural)",
    },
  },
};
