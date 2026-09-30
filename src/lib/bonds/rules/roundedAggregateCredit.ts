/** Allocate a rounded aggregate cash credit across its underlying receipts.
 * Consecutive differences telescope to the exact existing rounded cash write.
 * No extra cash or unexplained balancing entry is introduced.
 */
export function roundedAggregateCredit(previous: number, payment: number): number {
  return (Math.round((previous + payment) * 100) - Math.round(previous * 100)) / 100;
}
