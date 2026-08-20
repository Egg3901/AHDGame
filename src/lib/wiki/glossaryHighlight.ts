import { WIKI_GLOSSARY } from "@/lib/seeds/wiki/glossary";

export interface CompiledGlossaryTerm {
  canonical: string;
  definition: string;
  /** Lowercased phrases that map to this entry, longest first. */
  phrases: string[];
}

export interface GlossaryTextHit {
  type: "text";
  value: string;
}

export interface GlossaryTermHit {
  type: "term";
  value: string;
  canonical: string;
  definition: string;
}

export type GlossaryHit = GlossaryTextHit | GlossaryTermHit;

export interface CompiledGlossary {
  /** Source (no flags) for a case-insensitive global regex of all phrases. */
  source: string;
  terms: ReadonlyMap<string, { canonical: string; definition: string }>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a length-sorted matcher from the glossary map.
 * Longer phrases win (National Political Influence before PI).
 */
export function compileGlossary(
  glossary: Record<string, { definition: string; aliases?: readonly string[] }> = WIKI_GLOSSARY
): CompiledGlossary {
  const terms = new Map<string, { canonical: string; definition: string }>();
  const phrases: string[] = [];

  for (const [canonical, entry] of Object.entries(glossary)) {
    const all = [canonical, ...(entry.aliases ?? [])];
    for (const phrase of all) {
      const key = phrase.toLowerCase();
      if (terms.has(key)) continue;
      terms.set(key, { canonical, definition: entry.definition });
      phrases.push(phrase);
    }
  }

  phrases.sort((a, b) => b.length - a.length);
  const source = phrases.map((p) => `\\b${escapeRegExp(p)}\\b`).join("|");
  return { source, terms };
}

const DEFAULT_GLOSSARY = compileGlossary();

export function getCompiledGlossary(): CompiledGlossary {
  return DEFAULT_GLOSSARY;
}

/**
 * Split plain text into first-occurrence glossary hits.
 * `used` is mutated: once a canonical key is recorded, later matches stay plain text.
 * Does not look inside markdown; callers must skip code, links, and headings.
 */
export function splitGlossaryHits(
  text: string,
  used: Set<string>,
  compiled: CompiledGlossary = DEFAULT_GLOSSARY
): GlossaryHit[] {
  if (!text || !compiled.source) return text ? [{ type: "text", value: text }] : [];

  const regex = new RegExp(compiled.source, "gi");
  const hits: GlossaryHit[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const value = match[0];
    if (value.length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    if (match.index > last) {
      hits.push({ type: "text", value: text.slice(last, match.index) });
    }
    const lookup = compiled.terms.get(value.toLowerCase());
    if (!lookup || used.has(lookup.canonical)) {
      hits.push({ type: "text", value });
    } else {
      used.add(lookup.canonical);
      hits.push({
        type: "term",
        value,
        canonical: lookup.canonical,
        definition: lookup.definition,
      });
    }
    last = match.index + value.length;
  }

  if (last < text.length) {
    hits.push({ type: "text", value: text.slice(last) });
  }
  return hits.length > 0 ? hits : [{ type: "text", value: text }];
}
