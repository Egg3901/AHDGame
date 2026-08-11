import { Fragment, type ReactNode } from "react";

/** Render lightweight inline emphasis: paired `_..._` runs become <em>.
 * Unmatched underscores are left literal. Only emphasis is supported —
 * these strings are short policy-option flavor captions, not full markdown. */
export function renderInlineEmphasis(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Match _..._ where the content is non-empty and has no underscores.
  const re = /_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    nodes.push(<em key={key++}>{m[1]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return nodes;
}
