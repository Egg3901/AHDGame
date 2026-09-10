/**
 * Label formatting shared by the Slate tab and its assignment picker. Lives
 * apart from both so the picker does not have to import the tab that renders
 * it.
 */
export function formatSlateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
