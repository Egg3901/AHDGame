import { saveChartAsPNG } from "@/lib/charts/parliamentChart";

export type DiscordEventCardTone = "positive" | "election" | "warning" | "neutral";

export interface DiscordEventCardInput {
  eyebrow: string;
  title: string;
  summary: string;
  metadata?: readonly string[];
  detailLines?: readonly string[];
  tone?: DiscordEventCardTone;
  chartSvg?: string;
}

const WIDTH = 1200;
const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ENTITIES[character]);
}

function clamp(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function wrap(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = clamp(value, maxCharacters * maxLines).split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(" ").length;
  if (consumed < value.replace(/\s+/g, " ").trim().length && lines.length > 0) {
    lines[lines.length - 1] = clamp(lines[lines.length - 1], maxCharacters - 1) + "…";
  }
  return lines;
}

function toneColor(tone: DiscordEventCardTone): string {
  if (tone === "positive") return "#4ade80";
  if (tone === "election") return "#f2c94c";
  if (tone === "warning") return "#ef4444";
  return "#94a3b8";
}

/** Build a branded, fixed-size SVG that is converted to PNG before Discord delivery. */
export function buildDiscordEventCardSvg(input: DiscordEventCardInput): string {
  const accent = toneColor(input.tone ?? "neutral");
  const titleLines = wrap(input.title, 36, 2);
  const summaryLines = wrap(input.summary, 72, 2);
  const details = (input.detailLines ?? []).slice(0, 4).map((line) => clamp(line, 74));
  const metadata = (input.metadata ?? []).slice(0, 3).map((item) => clamp(item, 28));
  const hasChart = Boolean(input.chartSvg);
  const height = hasChart ? 950 + details.length * 52 : Math.max(560, 470 + details.length * 52);
  const chartData = input.chartSvg
    ? `data:image/svg+xml;base64,${Buffer.from(input.chartSvg).toString("base64")}`
    : undefined;

  const titleSvg = titleLines
    .map(
      (line, index) =>
        `<text x="84" y="${178 + index * 66}" class="title">${escapeXml(line)}</text>`
    )
    .join("");
  const summaryY = 178 + titleLines.length * 66 + 30;
  const summarySvg = summaryLines
    .map(
      (line, index) =>
        `<text x="84" y="${summaryY + index * 39}" class="summary">${escapeXml(line)}</text>`
    )
    .join("");
  const chipY = summaryY + summaryLines.length * 39 + 32;
  let chipX = 84;
  const chipsSvg = metadata
    .map((item) => {
      const width = Math.max(110, item.length * 17 + 44);
      const svg = `<rect x="${chipX}" y="${chipY}" width="${width}" height="42" rx="21" class="chip"/><text x="${chipX + 22}" y="${chipY + 28}" class="chipText">${escapeXml(item)}</text>`;
      chipX += width + 14;
      return svg;
    })
    .join("");
  const contentY = chipY + (metadata.length ? 78 : 28);
  const chartSvg = chartData
    ? `<rect x="74" y="${contentY}" width="1052" height="420" rx="22" fill="#111827"/><image x="94" y="${contentY + 20}" width="1012" height="380" preserveAspectRatio="xMidYMid meet" href="${chartData}"/>`
    : "";
  const detailY = hasChart ? contentY + 470 : contentY;
  const detailSvg = details
    .map(
      (line, index) =>
        `<circle cx="94" cy="${detailY + index * 52 - 9}" r="5" fill="${accent}"/><text x="116" y="${detailY + index * 52}" class="detail">${escapeXml(line)}</text>`
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#090d16"/></linearGradient>
    <radialGradient id="glow" cx="1" cy="0" r="1"><stop stop-color="${accent}" stop-opacity=".16"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <style>
      text { font-family: Inter, Arial, sans-serif; }
      .brand { fill: #f8fafc; font-size: 24px; font-weight: 800; letter-spacing: 4px; }
      .eyebrow { fill: ${accent}; font-size: 23px; font-weight: 800; letter-spacing: 2px; }
      .title { fill: #f8fafc; font-size: 54px; font-weight: 800; }
      .summary { fill: #cbd5e1; font-size: 29px; font-weight: 500; }
      .chip { fill: #1e293b; stroke: #334155; }
      .chipText { fill: #e2e8f0; font-size: 20px; font-weight: 700; }
      .detail { fill: #e2e8f0; font-size: 25px; font-weight: 600; }
    </style>
  </defs>
  <rect width="1200" height="${height}" rx="28" fill="url(#bg)"/>
  <rect width="1200" height="${height}" rx="28" fill="url(#glow)"/>
  <rect width="12" height="${height}" rx="6" fill="${accent}"/>
  <text x="84" y="62" class="brand">A HOUSE DIVIDED</text>
  <text x="1116" y="62" text-anchor="end" class="eyebrow">${escapeXml(clamp(input.eyebrow, 48).toUpperCase())}</text>
  <line x1="84" y1="88" x2="1116" y2="88" stroke="#334155"/>
  ${titleSvg}${summarySvg}${chipsSvg}${chartSvg}${detailSvg}
</svg>`;
}

export async function generateDiscordEventCard(
  input: DiscordEventCardInput,
  filename: string
): Promise<string | null> {
  return saveChartAsPNG(buildDiscordEventCardSvg(input), `event-${filename}`);
}
