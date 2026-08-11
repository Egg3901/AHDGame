export interface SeedPreviewRow {
  sectorType: string;
  boostPct: number;
  currentRevenue: number;
  projectedDelta: number;
}

export interface SeedPreviewResponse {
  rows: SeedPreviewRow[];
  totalCurrentRevenue: number;
  totalProjectedDelta: number;
  totalDocs: number;
  autoSectorSeedEnabled: boolean;
}
