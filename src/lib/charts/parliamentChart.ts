/**
 * Server-side parliament/hemicycle chart SVG generator.
 * Used for Discord embeds and other server-side image generation.
 */
import type { Db } from "@/lib/mongodb";
import type { PoliticalParty, ElectedOfficial } from "@/lib/db/types";
import { getPartyHex } from "@/lib/utils/politics";
import { MULTI_SEAT_TYPES } from "@/lib/utils/electionLabels";
import { westminsterParliamentSvgString } from "@/lib/charts/westminsterParliament";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { computeRowRadii, getParliamentSizing } from "@/lib/charts/parliamentSizing";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";

export interface PartySeatsData {
  party: string;
  partyName: string;
  partyColor: string;
  /** -5 left → +5 right, null = vacant */
  economicPosition: number | null;
  seats: number;
}

/** Sort parties left→right by economicPosition; vacant always last */
function sortLR(seats: PartySeatsData[]): PartySeatsData[] {
  return [...seats].sort((a, b) => {
    if (a.party === "__vacant__") return 1;
    if (b.party === "__vacant__") return -1;
    return (a.economicPosition ?? 0) - (b.economicPosition ?? 0);
  });
}

/**
 * Generate a parliament/hemicycle chart as an SVG string.
 * This is a server-side port of the client-side ParliamentChart component.
 *
 * @param seats - Array of party seat data
 * @param total - Total number of seats in the chamber
 * @param options - Optional configuration
 * @returns SVG string
 */
export function generateParliamentChartSVG(
  seats: PartySeatsData[],
  total: number,
  options: {
    width?: number;
    bgColor?: string;
    vacantColor?: string;
    showLabels?: boolean;
  } = {}
): string {
  const { width = 800, bgColor = "#1a1b26", vacantColor = "#3b3d4d", showLabels = true } = options;

  if (total === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 100" width="${width}" height="100">
      <rect width="100%" height="100%" fill="${bgColor}"/>
      <text x="50%" y="50%" fill="#888" font-size="14" text-anchor="middle" dominant-baseline="middle">No seats</text>
    </svg>`;
  }

  // Scale factor for the SVG
  const scale = width / 400;
  const cx = 200 * scale;
  const cy = 195 * scale;

  // Shared sizing tiers — keeps Discord embeds visually consistent with the
  // client `<ParliamentChart>` for any chamber size (US Senate → CN NPC).
  const sizing = getParliamentSizing(total);
  const dotR = sizing.dotR * scale;
  const { rowRadii: baseRowRadii } = computeRowRadii(sizing, total);
  const rowRadii = baseRowRadii.map((r) => r * scale);

  // 2. Distribute seats across rows proportionally to arc length
  const totalArc = rowRadii.reduce((s, r) => s + Math.PI * r, 0);
  const rowSeats: number[] = [];
  let remaining = total;
  for (let i = 0; i < rowRadii.length; i++) {
    if (i === rowRadii.length - 1) {
      rowSeats.push(remaining);
    } else {
      const n = Math.round(((Math.PI * rowRadii[i]) / totalArc) * total);
      const capped = Math.min(n, remaining);
      rowSeats.push(capped);
      remaining -= capped;
    }
  }

  // 3. Generate dot positions with fractional parameter t ∈ [0, 1]
  const dots: { x: number; y: number; t: number }[] = [];
  for (let row = 0; row < rowRadii.length; row++) {
    const r = rowRadii[row];
    const n = rowSeats[row];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const angle = Math.PI * (1 - t);
      dots.push({
        x: cx + r * Math.cos(angle),
        y: cy - r * Math.sin(angle),
        t,
      });
    }
  }

  // 4. Sort ALL dots by t (left → right)
  dots.sort((a, b) => a.t - b.t);

  // 5. Build flat color array in left→right party order
  const ordered = sortLR(seats);
  const dotData: { color: string; partyId: string }[] = [];
  for (const p of ordered) {
    for (let i = 0; i < p.seats; i++) {
      dotData.push({ color: p.partyColor, partyId: p.party });
    }
  }
  while (dotData.length < total) {
    dotData.push({ color: vacantColor, partyId: "__vacant__" });
  }

  // 6. Assign colors to sorted dots
  const coloredDots = dots.map((d, i) => ({ ...d, ...dotData[i] }));

  const outerR = rowRadii[rowRadii.length - 1];

  // Dynamic viewBox: expand horizontally/vertically when the arc geometry
  // would otherwise be clipped by the default `width × (cy + 16)` box.
  // Mirrors the client `<ParliamentChart>` so chambers of any size render
  // identically across the app and Discord embeds.
  const labelPadX = 8 * scale;
  const halfW = Math.max(width / 2, outerR + labelPadX);
  const vbX = cx - halfW;
  const vbW = halfW * 2;
  const labelPadTop = 12 * scale;
  const labelBaselineY = cy + 16 * scale;
  const vbY = Math.min(0, cy - outerR - labelPadTop);
  const vbH = labelBaselineY - vbY;

  // Build SVG string
  const circlesSvg = coloredDots
    .map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${dotR}" fill="${d.color}"/>`)
    .join("\n    ");

  const labelsSvg = showLabels
    ? `
    <!-- Vertical center / majority line -->
    <line x1="${cx}" y1="${cy - outerR - 8 * scale}" x2="${cx}" y2="${cy + 2 * scale}" stroke="#3b3d4d" stroke-width="${scale}" stroke-dasharray="4,3"/>
    <text x="${cx + 4 * scale}" y="${cy - outerR - 2 * scale}" fill="#888" font-size="${8 * scale}" font-family="sans-serif">½</text>
    <!-- Wing labels (anchored to viewBox edges so they stay in place when the box expands) -->
    <text x="${vbX + 12 * scale}" y="${cy + 12 * scale}" fill="#888" font-size="${8 * scale}" font-family="sans-serif">◄ Left</text>
    <text x="${vbX + vbW - 12 * scale}" y="${cy + 12 * scale}" fill="#888" font-size="${8 * scale}" font-family="sans-serif" text-anchor="end">Right ►</text>`
    : "";

  const renderedHeight = Math.round((vbH / vbW) * width);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${width}" height="${renderedHeight}">
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${bgColor}"/>
  ${labelsSvg}
  <!-- Dots -->
  ${circlesSvg}
</svg>`;
}

/**
 * Generate a simple horizontal bar chart for seat distribution.
 * Useful for Discord embeds as a simpler alternative to the hemicycle.
 */
export function generateSeatBarSVG(
  seats: PartySeatsData[],
  total: number,
  options: {
    width?: number;
    height?: number;
    bgColor?: string;
    vacantColor?: string;
  } = {}
): string {
  const { width = 600, height = 40, bgColor = "#1a1b26", vacantColor = "#3b3d4d" } = options;

  if (total === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="${bgColor}"/>
      <rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="${vacantColor}" rx="4"/>
    </svg>`;
  }

  const ordered = sortLR(seats);
  const filled = seats.reduce((s, p) => s + p.seats, 0);
  const vacant = total - filled;

  const bars: PartySeatsData[] =
    vacant > 0
      ? [
          ...ordered,
          {
            party: "__vacant__",
            partyName: "Vacant",
            partyColor: vacantColor,
            seats: vacant,
            economicPosition: null,
          },
        ]
      : ordered;

  const barHeight = height - 20;
  const barWidth = width - 20;
  let x = 10;

  const barsSvg = bars
    .map((p) => {
      const w = (p.seats / total) * barWidth;
      const rect = `<rect x="${x}" y="10" width="${w}" height="${barHeight}" fill="${p.partyColor}"/>`;
      x += w;
      return rect;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="${bgColor}"/>
  ${barsSvg}
</svg>`;
}

/**
 * Fetch chamber composition with economic positions for chart generation.
 */
export async function getChamberComposition(
  db: Db,
  chamber: string,
  countryId: string = "US"
): Promise<{ seats: PartySeatsData[]; totalSeats: number }> {
  const officialFilter: Record<string, unknown> = {
    // Resolve the chamber key to the office type seated members are stored under
    // (CN: "npc" → "npcDelegate"; identity elsewhere).
    officeType: getOfficeTypeForChamber(countryId as CountryId, chamber),
    $or: [{ characterId: { $ne: null } }, { isNPP: true }],
  };
  // eslint-disable-next-line local/no-country-literals -- backward compat for legacy US officials without countryId
  if (countryId === "US") {
    // Backward compatibility: legacy US officials may not have countryId populated.
    officialFilter.$and = [{ $or: [{ countryId: "US" }, { countryId: { $exists: false } }] }];
  } else {
    officialFilter.countryId = countryId;
  }

  const [officials, parties] = await Promise.all([
    db.collection<ElectedOfficial>("electedOfficials").find(officialFilter).toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId } as Record<string, unknown>)
      .toArray(),
  ]);

  // Safe: parties already filtered by countryId at query level (line 236)
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

  const tally = new Map<
    string,
    { partyName: string; partyColor: string; economicPosition: number | null; seats: number }
  >();

  for (const o of officials) {
    const partySlug = o.party ?? "independent";
    const seatCount = MULTI_SEAT_TYPES.has(chamber) ? (o.seatsHeld ?? 1) : 1;
    const p = partyMap.get(partySlug);
    const existing = tally.get(partySlug);

    if (existing) {
      existing.seats += seatCount;
    } else {
      tally.set(partySlug, {
        partyName: p?.name ?? (partySlug === "independent" ? "Independent" : partySlug),
        partyColor: getPartyHex(partySlug, p?.color),
        economicPosition: p?.economicPosition ?? null,
        seats: seatCount,
      });
    }
  }

  const seats: PartySeatsData[] = [...tally.entries()]
    .filter(([party]) => party !== "__vacant__")
    .map(([party, v]) => ({ party, ...v }))
    .sort((a, b) => b.seats - a.seats);

  const totalSeats = seats.reduce((s, c) => s + c.seats, 0);

  return { seats, totalSeats };
}

/**
 * Convert SVG to PNG and save to storage, returning a public URL.
 * Uses Cloudflare R2 in production, local filesystem in development.
 * Discord requires PNG/JPG/GIF for embed images (SVG not supported).
 */
export async function saveChartAsPNG(svgContent: string, filename: string): Promise<string | null> {
  const timestamp = Date.now();
  const fullFilename = `${filename}-${timestamp}.png`;

  try {
    // Convert SVG to PNG using sharp
    const sharp = (await import("sharp")).default;
    const pngBuffer = await sharp(Buffer.from(svgContent)).png().toBuffer();

    const { isR2Enabled, uploadFile } = await import("@/lib/r2");
    if (isR2Enabled()) {
      return await uploadFile(`charts/${fullFilename}`, pngBuffer, "image/png");
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");

      const chartsDir = path.join(process.cwd(), "uploads", "charts");
      await fs.mkdir(chartsDir, { recursive: true });

      const filePath = path.join(chartsDir, fullFilename);
      await fs.writeFile(filePath, pngBuffer);

      // Return a URL that can be served by the uploads API
      return `/api/uploads/charts/${fullFilename}`;
    }
  } catch (err) {
    console.error("[Charts] Failed to save chart as PNG:", err);
    return null;
  }
}

/**
 * Generate and save a chamber composition chart as PNG.
 * Returns the URL of the saved chart image, or null if generation fails.
 */
export async function generateAndSaveChamberChart(
  db: Db,
  chamber: string,
  totalSeatsTarget: number,
  countryId: string = "US"
): Promise<string | null> {
  try {
    const { seats } = await getChamberComposition(db, chamber, countryId);
    const svg =
      countryId === COUNTRY_CONFIGS.UK.id
        ? (westminsterParliamentSvgString(
            seats.map((s) => ({
              party: s.party,
              partyColor: s.partyColor,
              economicPosition: s.economicPosition,
              seats: s.seats,
            })),
            totalSeatsTarget,
            "#3b3d4d"
          ) ?? generateParliamentChartSVG(seats, totalSeatsTarget, { width: 600 }))
        : generateParliamentChartSVG(seats, totalSeatsTarget, { width: 600 });
    return await saveChartAsPNG(svg, `${chamber}-composition`);
  } catch (err) {
    console.error(`[Charts] Failed to generate ${chamber} chart:`, err);
    return null;
  }
}
