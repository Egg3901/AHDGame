/**
 * Minimal YAML frontmatter parser for changelog posts.
 * Supports scalars, quoted strings, and inline [a, b, c] arrays.
 */

function parseScalar(raw: string): string | string[] {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => {
      const s = part.trim();
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
      }
      return s;
    });
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith(">-") || trimmed.startsWith(">")) {
    return "";
  }

  return trimmed;
}

function parseBlockScalar(lines: string[], start: number): { value: string; next: number } {
  const parts: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      parts.push("");
      i++;
      continue;
    }
    if (!line.startsWith("  ") && !line.startsWith("\t")) break;
    parts.push(line.replace(/^\s{2}/, ""));
    i++;
  }
  return { value: parts.join("\n").trim(), next: i };
}

export function parseFrontmatter(raw: string): {
  data: Record<string, string | string[]>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, content: raw.trim() };
  }

  const data: Record<string, string | string[]> = {};
  const lines = match[1].split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      i++;
      continue;
    }

    const [, key, rest] = keyMatch;
    if (rest === ">-") {
      const block = parseBlockScalar(lines, i + 1);
      data[key] = block.value;
      i = block.next;
      continue;
    }

    // A flow array Prettier has wrapped across lines:
    //   tags:
    //     [
    //       mechanics,
    //       corporations,
    //     ]
    // Only the single-line form was handled, so a wrapped one fell through to
    // the block-scalar branch and became ONE tag containing the literal
    // brackets and commas. That tag then showed up as a filter chip reading
    // "[ mechanics, corporations, ... ]". Prettier reformats content/*.md on
    // commit, so the wrapped form is not avoidable by rewriting the file.
    const flowStart = rest === "" ? lines[i + 1]?.trim() : rest;
    if (flowStart?.startsWith("[") && !flowStart.endsWith("]")) {
      const parts: string[] = [];
      let j = rest === "" ? i + 1 : i;
      let buf = "";
      while (j < lines.length) {
        buf += lines[j].trim();
        if (lines[j].trim().endsWith("]")) break;
        j++;
      }
      const inner = buf.slice(buf.indexOf("[") + 1, buf.lastIndexOf("]"));
      for (const part of inner.split(",")) {
        const t = part.trim().replace(/^["']|["']$/g, "");
        if (t) parts.push(t);
      }
      data[key] = parts;
      i = j + 1;
      continue;
    }

    if (rest === "" || rest === ">") {
      const block = parseBlockScalar(lines, i + 1);
      data[key] = block.value;
      i = block.next;
      continue;
    }

    data[key] = parseScalar(rest);
    i++;
  }

  return { data, content: match[2].trim() };
}

export function asString(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : value;
}

export function asStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
