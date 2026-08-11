import sharp from "sharp";

interface OptimizeOptions {
  /** Max width in pixels — image is resized to fit within this bound */
  maxWidth: number;
  /** Max height in pixels — image is resized to fit within this bound */
  maxHeight: number;
  /** WebP quality (1-100). Default 80 */
  quality?: number;
}

/**
 * Optimize an uploaded image: resize to fit within max dimensions and
 * convert to WebP. GIFs are returned as-is to preserve animation.
 *
 * Returns { buffer, ext } where ext is the file extension to use.
 */
export async function optimizeImage(
  inputBuffer: Buffer,
  mimeType: string,
  options: OptimizeOptions
): Promise<{ buffer: Buffer; ext: string }> {
  // Preserve animated GIFs and SVGs as-is (sharp can't process these meaningfully)
  if (mimeType === "image/gif") {
    return { buffer: inputBuffer, ext: "gif" };
  }
  if (mimeType === "image/svg+xml") {
    return { buffer: inputBuffer, ext: "svg" };
  }

  const { maxWidth, maxHeight, quality = 80 } = options;

  const optimized = await sharp(inputBuffer)
    .resize(maxWidth, maxHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer();

  return { buffer: optimized, ext: "webp" };
}

/** Preset configs for each upload type */
export const IMAGE_PRESETS = {
  avatar: { maxWidth: 256, maxHeight: 256, quality: 85 },
  corporationLogo: { maxWidth: 256, maxHeight: 256, quality: 85 },
  corporationHeader: { maxWidth: 1400, maxHeight: 400, quality: 80 },
  profileHeader: { maxWidth: 1400, maxHeight: 400, quality: 80 },
  partyLogo: { maxWidth: 256, maxHeight: 256, quality: 85 },
  coatOfArms: { maxWidth: 512, maxHeight: 512, quality: 85 },
  /** Wide hero for optional news post images (16:9-ish cap). */
  newsHero: { maxWidth: 1200, maxHeight: 675, quality: 82 },
  /** Horizontal player-submitted banner ad. */
  bannerAd: { maxWidth: 970, maxHeight: 250, quality: 82 },
  /** Inline images embedded inside wiki markdown content. */
  wikiImage: { maxWidth: 1600, maxHeight: 1600, quality: 82 },
} as const;
