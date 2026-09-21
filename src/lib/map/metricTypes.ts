/** Public, display-only state metric snapshots for the map explorer. */
export interface MapMetricDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  prefix: string;
  suffix: string;
  decimals: number;
  source: "state" | "macro" | "score";
}
export interface MapMetricsResponse {
  definitions: MapMetricDefinition[];
  states: Record<string, Record<string, number>>;
}
