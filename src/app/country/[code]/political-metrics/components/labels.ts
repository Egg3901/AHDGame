/**
 * Sentence case for catalog phrases that arrive in title case, such as the
 * governance headlines ("Democracy Under Strain") and the lean labels
 * ("Strong Left"). The registry prints headings and labels in sentence case.
 * These phrases carry no proper nouns, so lowering everything after the first
 * letter is safe for them. Do not use it on metric or category names, which
 * are names and keep their own capitals.
 */
export function sentenceCase(phrase: string): string {
  if (!phrase) return phrase;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1).toLowerCase();
}
