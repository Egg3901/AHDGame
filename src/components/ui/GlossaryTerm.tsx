"use client";

import { WikiGlossaryTerm } from "@/components/wiki/WikiGlossaryTerm";
import { WIKI_GLOSSARY, type WikiGlossaryKey } from "@/lib/seeds/wiki/glossary";

type GlossaryTermProps =
  | { term: WikiGlossaryKey; label?: string; definition?: never }
  | { term: string; label?: string; definition: string };

/**
 * An abbreviation or game term with a hover/tap definition, for places where
 * the short form has to stay short (table headers, stat labels). Glossary keys
 * pull the shared wiki definition; anything else passes its own.
 *
 * Spell terms out in prose and button labels instead. The trigger is itself a
 * button, so never nest this inside a button or link.
 */
export function GlossaryTerm({ term, label, definition }: GlossaryTermProps) {
  const text = definition ?? WIKI_GLOSSARY[term as WikiGlossaryKey].definition;
  return <WikiGlossaryTerm term={term} definition={text} label={label} />;
}
