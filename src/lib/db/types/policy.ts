export interface PolicyPosition {
  value: number;
  label: string;
  description?: string;
}

export interface Policy {
  _id: string;
  name: string;
  description: string;
  category: "social" | "economic";
  positions: PolicyPosition[];
}
