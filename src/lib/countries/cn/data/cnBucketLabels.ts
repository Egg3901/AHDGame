import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const CN_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "民族 (Background)",
    age: "年龄 (Age)",
    education: "教育 (Education)",
    income: "收入 (Income)",
    urbanization: "居住地 (Where they live)",
  },
  buckets: {
    ethnicity: {
      han: "汉族 (Han)",
      zhuang: "壮族 (Zhuang)",
      hui: "回族 (Hui)",
      uyghur: "维吾尔族 (Uyghur)",
      tibetan: "藏族 (Tibetan)",
      other_minority: "其他少数民族 (Other minorities)",
    },
    age: {
      young: "30岁以下 (Under 30)",
      mid: "30–49岁 (30s and 40s)",
      mature: "50–64岁 (50s and 60s)",
      senior: "65岁以上 (Over 65)",
    },
    education: {
      primary_or_below: "小学及以下 (Primary or below)",
      secondary: "中学 (Secondary)",
      vocational: "职业教育 (Vocational)",
      university: "大学 (University)",
    },
    income: {
      low: "低收入 (Lower income)",
      middle: "中等收入 (Middle income)",
      high: "高收入 (Higher income)",
    },
    urbanization: {
      urban: "城市 (Cities)",
      suburban: "城郊 (Suburbs)",
      rural: "农村 (Rural)",
    },
  },
};
