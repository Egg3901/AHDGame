import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const GR_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "Καταγωγή (Background)",
    age: "Ηλικία (Age)",
    education: "Εκπαίδευση (Education)",
    income: "Εισόδημα (Income)",
    urbanization: "Τόπος διαμονής (Where they live)",
  },
  buckets: {
    ethnicity: {
      greek: "Έλληνες (Greeks)",
      minority: "Μειονότητες (Minorities)",
      other: "Άλλες καταγωγές (Other backgrounds)",
    },
    age: {
      young: "Κάτω των 30 (Under 30)",
      mid: "30–49 (30s and 40s)",
      mature: "50–64 (50s and 60s)",
      senior: "Άνω των 65 (Over 65)",
    },
    education: {
      primary_or_below: "Δημοτικό ή λιγότερο (Primary or below)",
      secondary: "Λύκειο (Secondary)",
      vocational: "Επαγγελματική εκπαίδευση (Vocational)",
      university: "Πανεπιστήμιο (University)",
    },
    income: {
      low: "Χαμηλό εισόδημα (Lower income)",
      middle: "Μεσαίο εισόδημα (Middle income)",
      high: "Υψηλό εισόδημα (Higher income)",
    },
    urbanization: {
      urban: "Πόλεις (Cities)",
      suburban: "Προάστια (Suburbs)",
      rural: "Επαρχία (Rural)",
    },
  },
};
