"use client";

import { useEffect, useState } from "react";
import { BLEND_HEX, blendGroundHex } from "./tokens";

/**
 * The active theme's Blend page ground as hex, kept current as the reader
 * switches theme. Margin-tier shades fade toward this colour, so a light theme
 * shades toward its own light page instead of the dark one.
 *
 * Starts on the dark ground (which is what the server renders) and corrects
 * itself after mount.
 */
export function useBlendGround(): string {
  const [ground, setGround] = useState<string>(BLEND_HEX.page);
  useEffect(() => {
    const read = () => setGround(blendGroundHex());
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return ground;
}
