/**
 * Browser fingerprinting via ThumbmarkJS (MIT), client-only mode.
 *
 * CLIENT-ONLY: never pass `api_key` / `api_endpoint` to ThumbmarkJS. Doing so
 * would route identification through the paid SaaS and reintroduce a request
 * quota. We call `getThumbmark()` with no API credentials, so it computes the
 * fingerprint entirely in-browser and makes no network request to ThumbmarkJS.
 *
 * `generateFingerprint()` keeps its historical signature (returns a single hash
 * string) so existing callers and the registration gate are unaffected.
 * `generateFingerprintData()` additionally returns a small, stable, normalized
 * component subset used for component-level fuzzy matching in detection.
 */
import { getThumbmark } from "@thumbmarkjs/thumbmarkjs";

/** Length of the legacy truncated fingerprint stored before the full-hash migration. */
export const LEGACY_FINGERPRINT_LENGTH = 16;

/**
 * Normalized, storage-friendly subset of fingerprint components. Anchors
 * (canvas, webglRenderer, audio) are the hardest-to-forge, hardware-derived
 * signals; the rest are secondary. Detection's fuzzy matcher operates on THIS
 * shape, not ThumbmarkJS's raw (version-dependent) tree.
 */
export interface StoredFingerprintComponents {
  canvas?: string;
  webglRenderer?: string;
  audio?: string;
  fonts?: string;
  cores?: number;
  memory?: number;
  screen?: string;
  timezone?: string;
  platform?: string;
  /** Unmasked WebGL vendor string (`WEBGL_debug_renderer_info`'s
   * `UNMASKED_VENDOR_WEBGL`), read directly rather than through ThumbmarkJS
   * — modest client-entropy addition, pairs with `webglRenderer`. */
  webglVendor?: string;
  /** `navigator.languages`, joined with `,` (e.g. `"en-US,en"`). */
  languages?: string;
}

// Volatile components excluded from the hash so it survives browser updates and
// transient permission changes. Dot-paths follow ThumbmarkJS's component tree.
const EXCLUDED_COMPONENTS = ["system.browser.version", "permissions"];

function asString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Map ThumbmarkJS's raw component tree to our normalized shape. Defensive: any
 * missing/renamed path simply yields `undefined` for that field rather than
 * throwing. The GPU renderer is read from `webgl.renderer` with a fallback to
 * `hardware.videocard.renderer` (ThumbmarkJS has placed it in both across
 * versions). VERIFY the live tree during the manual smoke (Task 10) and adjust
 * the accessors if a field comes back empty.
 */
export function extractComponents(raw: unknown): StoredFingerprintComponents {
  const c = (raw ?? {}) as Record<string, unknown>;
  const webgl = (c.webgl ?? {}) as Record<string, unknown>;
  const hardware = (c.hardware ?? {}) as Record<string, unknown>;
  const videocard = (hardware.videocard ?? {}) as Record<string, unknown>;
  const system = (c.system ?? {}) as Record<string, unknown>;

  return {
    canvas: asString(c.canvas),
    webglRenderer: asString(webgl.renderer ?? videocard.renderer),
    audio: asString(c.audio),
    fonts: asString(c.fonts),
    cores: asNumber(hardware.cores),
    memory: asNumber(hardware.memory ?? hardware.deviceMemory),
    screen: asString(c.screen),
    timezone: asString(system.timezone),
    platform: asString(system.platform),
  };
}

/**
 * Read the WebGL vendor + renderer directly via `WEBGL_debug_renderer_info`,
 * independent of ThumbmarkJS's own extraction (which supplies
 * `webglRenderer` as a fallback when this probe is unavailable — a blocked
 * or unsupported WebGL context here just yields `{}`, never a fabricated
 * value, so the degenerate-fingerprint guard still applies downstream).
 * MODEST by design: creates one throwaway canvas, reads two parameters, does
 * not render anything or read back pixel data (that's the heavier canvas
 * fingerprint ThumbmarkJS already owns separately).
 */
function getWebglUnmasked(): { vendor?: string; renderer?: string } {
  if (typeof document === "undefined") return {};
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return {};
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return {};
    const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    return {
      vendor: typeof vendor === "string" && vendor ? vendor : undefined,
      renderer: typeof renderer === "string" && renderer ? renderer : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Modest, non-invasive `navigator.*` entropy: core count, platform string,
 * and the full language preference list (order-sensitive — richer than a
 * single `navigator.language`). No font enumeration, no WebRTC IP probing.
 */
function getNavigatorEntropy(): {
  hardwareConcurrency?: number;
  platform?: string;
  languages?: string;
} {
  if (typeof navigator === "undefined") return {};
  const hardwareConcurrency =
    typeof navigator.hardwareConcurrency === "number" &&
    Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : undefined;
  const platform =
    typeof navigator.platform === "string" && navigator.platform ? navigator.platform : undefined;
  const languages =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages.join(",")
      : undefined;
  return { hardwareConcurrency, platform, languages };
}

export async function generateFingerprintData(): Promise<{
  hash: string;
  components: StoredFingerprintComponents;
}> {
  if (typeof window === "undefined") {
    return { hash: "server-side", components: {} };
  }
  const data = await getThumbmark({ exclude: EXCLUDED_COMPONENTS });
  const components = extractComponents(data.components);

  // Modest client-entropy additions (forensics-v2 Part B), layered on top of
  // ThumbmarkJS's own extraction. Each is filled only when ThumbmarkJS
  // didn't already supply it (or, for the WebGL renderer, when our direct
  // `WEBGL_debug_renderer_info` probe succeeds — the more precise of the two
  // sources) — never overwrite a present value with an absent one, and never
  // fabricate a value when the probe is blocked/unsupported.
  const webgl = getWebglUnmasked();
  if (webgl.renderer) components.webglRenderer = webgl.renderer;
  if (webgl.vendor) components.webglVendor = webgl.vendor;

  const nav = getNavigatorEntropy();
  if (components.cores == null && nav.hardwareConcurrency != null) {
    components.cores = nav.hardwareConcurrency;
  }
  if (!components.platform && nav.platform) components.platform = nav.platform;
  if (nav.languages) components.languages = nav.languages;

  return { hash: data.thumbmark, components };
}

export async function generateFingerprint(): Promise<string> {
  const { hash } = await generateFingerprintData();
  return hash;
}
