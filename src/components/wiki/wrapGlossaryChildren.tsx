"use client";

import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { WikiGlossaryTerm } from "@/components/wiki/WikiGlossaryTerm";
import {
  getCompiledGlossary,
  splitGlossaryHits,
  type CompiledGlossary,
} from "@/lib/wiki/glossaryHighlight";

const SKIP_GLOSSARY_PROP = "data-wiki-no-glossary";

function wrapString(text: string, used: Set<string>, compiled: CompiledGlossary): ReactNode {
  const hits = splitGlossaryHits(text, used, compiled);
  if (hits.length === 1 && hits[0]?.type === "text") return text;
  return hits.map((hit, i) => {
    if (hit.type === "text") return hit.value;
    return (
      <WikiGlossaryTerm
        key={`${hit.canonical}-${i}-${hit.value}`}
        term={hit.value}
        definition={hit.definition}
      />
    );
  });
}

function shouldSkip(node: ReactElement): boolean {
  const props = node.props as Record<string, unknown>;
  if (props[SKIP_GLOSSARY_PROP] != null && props[SKIP_GLOSSARY_PROP] !== false) return true;
  if (typeof node.type === "string") {
    return (
      node.type === "a" || node.type === "code" || node.type === "pre" || /^h[1-6]$/.test(node.type)
    );
  }
  return false;
}

/**
 * Walk a react-markdown child tree and wrap the first glossary hit per canonical
 * term. Skips links, code, and headings (marked with data-wiki-no-glossary).
 */
export function wrapGlossaryChildren(children: ReactNode, used: Set<string>): ReactNode {
  const compiled = getCompiledGlossary();
  return wrapNode(children, used, compiled);
}

function wrapNode(node: ReactNode, used: Set<string>, compiled: CompiledGlossary): ReactNode {
  if (node == null || typeof node === "boolean") return node;
  if (typeof node === "string") return wrapString(node, used, compiled);
  if (typeof node === "number") return node;
  if (Array.isArray(node)) {
    return Children.map(node, (child) => wrapNode(child, used, compiled));
  }
  if (!isValidElement(node)) return node;
  if (shouldSkip(node)) return node;
  const childProps = node.props as { children?: ReactNode };
  if (childProps.children == null) return node;
  return cloneElement(node, undefined, wrapNode(childProps.children, used, compiled));
}

export { SKIP_GLOSSARY_PROP };
