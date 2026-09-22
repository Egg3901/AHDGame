import { SHIPPING_PRESETS, type ShippingPreset } from "@/lib/world/eraRoster";

const shippingPresetSet = new Set<string>(SHIPPING_PRESETS);

/** Resolve legacy bare-era aliases and reject jobs that cannot load a world manifest. */
export function resolveSimPreset(input: string): ShippingPreset {
  const canonical = shippingPresetSet.has(input) ? input : `${input}-default`;
  if (!shippingPresetSet.has(canonical)) {
    throw new Error(
      `Unsupported simulation preset ${JSON.stringify(input)}. Expected one of: ${SHIPPING_PRESETS.join(", ")}`
    );
  }
  return canonical as ShippingPreset;
}
