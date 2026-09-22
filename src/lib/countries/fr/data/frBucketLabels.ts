import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const FR_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Origine",
    age: "Âge",
    education: "Diplôme",
    income: "Revenus",
    urbanization: "Lieu de vie",
  },
  buckets: {
    ethnicity: {
      french: "Français",
      european_immigrant: "Immigration européenne",
      north_african: "Maghrébins",
      other: "Autres origines",
    },
    age: {
      young: "Moins de 30 ans",
      mid: "30 à 49 ans",
      mature: "50 à 64 ans",
      senior: "Plus de 65 ans",
    },
    education: {
      primary_or_below: "Sans diplôme",
      secondary: "Baccalauréat",
      vocational: "Formation professionnelle",
      university: "Études supérieures",
    },
    income: { low: "Bas revenus", middle: "Revenus moyens", high: "Hauts revenus" },
    urbanization: { urban: "Villes", suburban: "Banlieues", rural: "Campagne" },
  },
};
