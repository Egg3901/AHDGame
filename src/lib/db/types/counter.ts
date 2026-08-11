/**
 * Counter document for tracking sequential IDs.
 * Used to generate unique numeric IDs for Characters and NPPs.
 */
export interface Counter {
  _id: string; // "character" | "npp"
  seq: number; // Current highest assigned ID
}
