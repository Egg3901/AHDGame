/** localStorage keys for one-time "New" badges on the corporation page. */
export const CORP_PAGE_FEATURE_KEYS = {
  commoditiesTab: "ahd.corpPageFeatureSeen.commoditiesTab",
  marketShareChart: "ahd.corpPageFeatureSeen.marketShareChart",
} as const;

export type CorpPageFeatureKey =
  (typeof CORP_PAGE_FEATURE_KEYS)[keyof typeof CORP_PAGE_FEATURE_KEYS];
