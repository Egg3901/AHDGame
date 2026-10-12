/** Group identity, strategy and voluntary receiving preferences belong to the current world. */
export type GroupSupplyPolicy = "independent" | "members";
export type GroupObjective =
  "balanced" | "profit" | "capacity" | "expansion" | "regional" | "stability";
export interface GroupManagement {
  name: string;
  logoUrl?: string;
  supplyPolicy: GroupSupplyPolicy;
}
export interface GroupReceivingPreference {
  /** Changes when a recorded CEO tenure ends or a new one starts. */
  ceoTenureKey?: string;
  rootId: string;
  ceoId: string;
  userId: string;
  enabled: boolean;
  effectiveTurn: number;
  /** Previous preference remains effective until effectiveTurn. */
  previousEnabled: boolean;
}
export interface GroupDirection {
  revision: string;
  rootId: string;
  objective: GroupObjective;
  regions: string[];
  allowInvestment: boolean;
  setTurn: number;
  response: "pending" | "acknowledged" | "declined";
  /** Binds player responses to the operator who received the suggestion. */
  ceoId: string;
}
