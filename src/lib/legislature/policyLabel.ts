/** Split a combined `"Title: description"` policy-option label into its parts.
 * Splits on the FIRST `": "`; later separators stay in the description.
 * Mirrors the split the national bill page has always used for the title. */
export function splitPolicyLabel(label?: string | null): { title?: string; description?: string } {
  if (!label) return {};
  const idx = label.indexOf(": ");
  if (idx === -1) return { title: label };
  return { title: label.slice(0, idx), description: label.slice(idx + 2) };
}
