import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeImage, IMAGE_PRESETS } from "./imageOptimize";
import { ApiError } from "@/lib/api/errors";

describe("optimizeImage", () => {
  it("converts a valid image to webp", async () => {
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    const { buffer, ext } = await optimizeImage(png, "image/png", IMAGE_PRESETS.avatar);
    expect(ext).toBe("webp");
    expect((await sharp(buffer).metadata()).format).toBe("webp");
  });

  it("turns a truncated image into a 400 instead of an unhandled decode error", async () => {
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    // Chop the tail: libvips throws "VipsJpeg: premature end of JPEG image".
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 2));

    await expect(
      optimizeImage(truncated, "image/jpeg", IMAGE_PRESETS.avatar)
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      optimizeImage(truncated, "image/jpeg", IMAGE_PRESETS.avatar)
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("passes GIFs and SVGs through untouched", async () => {
    const raw = Buffer.from("not really an image");
    await expect(optimizeImage(raw, "image/gif", IMAGE_PRESETS.avatar)).resolves.toEqual({
      buffer: raw,
      ext: "gif",
    });
    await expect(optimizeImage(raw, "image/svg+xml", IMAGE_PRESETS.avatar)).resolves.toEqual({
      buffer: raw,
      ext: "svg",
    });
  });
});
