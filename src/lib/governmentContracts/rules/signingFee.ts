/** Signing fees conserve anchor value across the corporation's and government's native currencies. */
export function signingFeeCredit(
  debitedLocal: number,
  sourceLocalPerAnchor: number,
  destinationLocalPerAnchor: number
) {
  if (
    ![debitedLocal, sourceLocalPerAnchor, destinationLocalPerAnchor].every(Number.isFinite) ||
    debitedLocal < 0 ||
    sourceLocalPerAnchor <= 0 ||
    destinationLocalPerAnchor <= 0
  )
    return null;
  const anchor = debitedLocal / sourceLocalPerAnchor;
  const destinationLocal = anchor * destinationLocalPerAnchor;
  if (!Number.isFinite(anchor) || !Number.isFinite(destinationLocal)) return null;
  return { anchor, destinationLocal };
}
