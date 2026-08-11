/**
 * Background option sets for the creator.
 *
 * Values must stay byte-identical to what `POST /api/auth/character` accepts —
 * only the presentation changed when these moved off native `<select>`s.
 */

export const RACE_OPTIONS = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "hispanic", label: "Hispanic" },
  { value: "asian", label: "Asian" },
  { value: "other", label: "Other" },
] as const;

export const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "nonbinary", label: "Non-binary" },
] as const;

export const EDUCATION_OPTIONS = [
  { value: "no_college", label: "No degree" },
  { value: "college", label: "College" },
  { value: "graduate", label: "Graduate" },
] as const;

/** Resolve a stored demographic value to its display label. */
export function labelFor(
  options: readonly { value: string; label: string }[],
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? "—";
}
