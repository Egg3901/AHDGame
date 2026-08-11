/**
 * Content moderation utilities.
 * - **News / replies:** use `containsSlur()` only so ordinary swears are allowed in body text.
 * - **Names / display names:** use `containsBlockedName()` (`containsSlur` + moderate profanity).
 */

// Each pattern uses word-boundary anchors and covers common letter substitutions.
// Intentionally not exhaustive — catches the most common English slurs.
const SLUR_PATTERNS: RegExp[] = [
  // Racial slurs — Black
  /\bn[i1!]+[g9]+[e3]+r/i,
  /\bn[i1!]+[g9]{2,}/i,
  /\bcoon\b/i,
  /\bspook\b/i,
  /\bjig+a?b[o0]+\b/i,
  /\bporch\s*monk/i,
  /\bsambo\b/i,
  /\bdarkie\b/i,
  /\bpickaninny\b/i,
  /\bmulatt[oa]\b/i,

  // Racial slurs — Asian
  /\bchink\b/i,
  /\bgook\b/i,
  /\bslant\s*eye/i,
  /\bnip\b/i,
  /\bjap\b/i,
  /\bzipper\s*head/i,
  /\byelow\b/i,

  // Racial slurs — Hispanic/Latino
  /\bspic\b/i,
  /\bbeaner\b/i,
  /\bwetback\b/i,
  /\bgreaser\b/i,

  // Racial slurs — White (still slurs)
  /\bhonky\b/i,
  /\bcracker\b/i,
  /\bwhite\s*trash\b/i,

  // Racial slurs — Jewish
  /\bk[i1]+ke\b/i,
  /\bheb[e3]+\b/i,
  /\bz[i1]+og\b/i,

  // Racial slurs — Middle Eastern / South Asian
  /\brag\s*head\b/i,
  /\btowel\s*head\b/i,
  /\bsand\s*n[i1]g/i,
  /\bpak[i1]\b/i,
  /\bcamel\s*jock/i,
  /\bhajji\b/i,

  // Racial slurs — Indigenous
  /\bsquaw\b/i,
  /\bredskin\b/i,

  // Racial slurs — Irish / Italian
  /\bmick\b/i,
  /\bwop\b/i,
  /\bdago\b/i,
  /\bguinea\b/i,

  // LGBT slurs
  /\bf[a@4]+gg?[o0]+t/i,
  /\bf[a@4]+g\b/i,
  /\bd[yi]+k[e3]\b/i,
  /\btr[a@4]+nn[yi]/i,
  /\bsh[e3]male\b/i,

  // Religious slurs
  /\btowel\s*head\b/i,
  /\bpapist\b/i,
  /\bprot[e3]stant\s*scum\b/i,
  /\binfid[e3]l\b/i,
];

// Short list for names and display names only. Keep this narrower than the slur
// filter so ordinary words like "ass" or "Dick" remain valid.
const MODERATE_PROFANITY_PATTERNS: RegExp[] = [
  /\bf[\W_]*u[\W_]*c[\W_]*k(?:\w*)?\b/i,
  /\br[\W_]*a[\W_]*p[\W_]*e(?:d|r|rs|s|ing|ist)?\b/i,
  /\bb[\W_]*i[\W_]*t[\W_]*c[\W_]*h(?:es|y|ing|es)?\b/i,
  /\bc[\W_]*u[\W_]*n[\W_]*t(?:s|y|ing)?\b/i,
  /\bs[\W_]*h[\W_]*i[\W_]*t(?:s|ty|ting)?\b/i,
  /\ba[\W_]*s[\W_]*s[\W_]*h[\W_]*o[\W_]*l[\W_]*e(?:s)?\b/i,
  /\bb[\W_]*a[\W_]*s[\W_]*t[\W_]*a[\W_]*r[\W_]*d(?:s)?\b/i,
  /\bw[\W_]*h[\W_]*o[\W_]*r[\W_]*e(?:s|y|d|ing)?\b/i,
  /\bs[\W_]*l[\W_]*u[\W_]*t(?:s|ty|ting)?\b/i,
  /\bm[\W_]*o[\W_]*t[\W_]*h[\W_]*e[\W_]*r[\W_]*f[\W_]*u[\W_]*c[\W_]*k[\W_]*e[\W_]*r(?:s)?\b/i,
];

/**
 * Returns true if the text contains a blocked slur.
 */
export function containsSlur(text: string): boolean {
  return SLUR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Returns true if the text contains a blocked word for names/display names.
 */
export function containsModerateProfanity(text: string): boolean {
  return MODERATE_PROFANITY_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Returns true if a name should be rejected by moderation.
 */
export function containsBlockedName(text: string): boolean {
  return containsSlur(text) || containsModerateProfanity(text);
}
