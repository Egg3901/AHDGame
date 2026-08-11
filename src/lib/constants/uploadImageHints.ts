/**
 * Copy for image upload areas. Display uses `object-cover` in most places — callers should
 * remind users to center important content when aspect ratios differ by viewport.
 */
export const UPLOAD_IMAGE_HINTS = {
  profileBanner: {
    long: "Wide banner image. Use a wide aspect ratio such as 21:9 (for example 2100 by 900 pixels) or 3:1 (1500 by 500). Banner height changes by screen size and the image is cropped to fit—keep important content centered.",
    short: "Wide (21:9–3:1) · e.g. 1500 × 500 px · center important content",
  },
  avatar: {
    long: "Square image. At least 256 by 256 pixels recommended. Shown up to about 176 pixels wide with rounded crop.",
    short: "Square · min 256 × 256 px",
  },
  corporationBanner: {
    long: "Wide banner image. About 6:1 works well (for example 1920 by 330 pixels). Height varies by screen size; image is cropped to fit—keep focal content centered.",
    short: "~6:1 · e.g. 1920 × 330 px · center focal content",
  },
  corporationLogo: {
    long: "Square image. At least 256 by 256 pixels recommended; shown up to 64 pixels with rounded corners.",
    short: "Square · min 256 × 256 px",
  },
  partyLogo: {
    long: "Square image. At least 256 by 256 pixels; SVG or raster; shown in a circle.",
    short: "Square · min 256 × 256 px",
  },
} as const;
