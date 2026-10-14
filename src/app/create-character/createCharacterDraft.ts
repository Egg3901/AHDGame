/**
 * Saved progress for the character creator, kept on this device only.
 *
 * Stored per account so a shared browser never offers one player another
 * player's half-built character. Portrait and header files are not saved; they
 * are optional and can be added from the profile later.
 */

const DRAFT_KEY_PREFIX = "ahd:create-character-draft:";
const DRAFT_VERSION = 1;
/** A draft older than this is a different world's character; drop it. */
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreateCharacterDraftForm {
  characterName: string;
  homeState: string;
  party: string;
  policyPositions: { economic: number; social: number };
  demographics: { race: string; gender: string; education: string; wealth: string };
}

export interface CreateCharacterDraft<S extends Record<string, number>> {
  country: string;
  formData: CreateCharacterDraftForm;
  stats: S | null;
  compassTouched: boolean;
  partyTouched: boolean;
}

interface StoredDraft {
  v: number;
  savedAt: number;
  draft: CreateCharacterDraft<Record<string, number>>;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validForm(v: unknown): v is CreateCharacterDraftForm {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  const p = f.policyPositions as Record<string, unknown> | undefined;
  const d = f.demographics as Record<string, unknown> | undefined;
  return (
    isString(f.characterName) &&
    f.characterName.length <= 100 &&
    isString(f.homeState) &&
    isString(f.party) &&
    !!p &&
    isFiniteNumber(p.economic) &&
    isFiniteNumber(p.social) &&
    !!d &&
    isString(d.race) &&
    isString(d.gender) &&
    isString(d.education) &&
    isString(d.wealth)
  );
}

/** Stats only restore when they have exactly the current stat keys. */
function validStats<S extends Record<string, number>>(v: unknown, template: S): S | null {
  if (!v || typeof v !== "object") return null;
  const stats = v as Record<string, unknown>;
  const keys = Object.keys(template);
  if (Object.keys(stats).length !== keys.length) return null;
  for (const k of keys) if (!isFiniteNumber(stats[k])) return null;
  return stats as S;
}

export function readCreateCharacterDraft<S extends Record<string, number>>(
  userId: string,
  statTemplate: S,
  now: number = Date.now()
): CreateCharacterDraft<S> | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY_PREFIX + userId);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredDraft;
    if (stored?.v !== DRAFT_VERSION || !isFiniteNumber(stored.savedAt)) return null;
    if (now - stored.savedAt > DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(DRAFT_KEY_PREFIX + userId);
      return null;
    }
    const d = stored.draft;
    if (!d || !isString(d.country) || !validForm(d.formData)) return null;
    return {
      country: d.country,
      formData: d.formData,
      stats: validStats(d.stats, statTemplate),
      compassTouched: d.compassTouched === true,
      partyTouched: d.partyTouched === true,
    };
  } catch {
    return null;
  }
}

export function writeCreateCharacterDraft<S extends Record<string, number>>(
  userId: string,
  draft: CreateCharacterDraft<S>,
  now: number = Date.now()
): void {
  try {
    const stored: StoredDraft = { v: DRAFT_VERSION, savedAt: now, draft };
    window.localStorage.setItem(DRAFT_KEY_PREFIX + userId, JSON.stringify(stored));
  } catch {
    // Storage full or disabled: the form still works, it just is not saved.
  }
}

export function clearCreateCharacterDraft(userId: string): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY_PREFIX + userId);
  } catch {
    // Nothing to clear.
  }
}
