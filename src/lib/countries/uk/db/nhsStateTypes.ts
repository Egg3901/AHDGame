/**
 * UK NHS state (epic #856, ticket #858). Singleton — one document per world.
 * Holds the running NHS quality score (0..100) driven by Budget healthcare
 * funding vs demand; ticked each turn. Collection: "ukNhsState".
 */
export interface UKNhsState {
  _id: "current";
  /** Running service-quality score, 0..100. */
  quality: number;
  /** Healthcare share (%) of the last Budget the tick read, for display. */
  lastHealthcareShare?: number;
  updatedAt: Date;
}
