export { getTypeColor } from "@/components/corporation/CorporationHelpers";

export function modColor(val: number): string {
  if (val > 0) return "text-success";
  if (val < 0) return "text-error";
  return "text-muted";
}

export function modSign(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}
