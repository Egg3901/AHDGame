import {
  Building2,
  Car,
  Clapperboard,
  Cpu,
  Factory,
  FlaskConical,
  HardHat,
  HeartPulse,
  Landmark,
  Newspaper,
  Pickaxe,
  Shield,
  ShoppingCart,
  Truck,
  Wheat,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { CorporationType } from "@/lib/constants/corporations";

/** Identity icon per corporation/sector type, for National Corporation surfaces. */
const SECTOR_ICON: Partial<Record<CorporationType, LucideIcon>> = {
  energy: Zap,
  telecommunications: Wifi,
  technology: Cpu,
  healthcare: HeartPulse,
  logistics: Truck,
  automobiles: Car,
  agriculture: Wheat,
  financial: Landmark,
  defense: Shield,
  manufacturing: Factory,
  construction: HardHat,
  real_estate: Building2,
  media: Newspaper,
  entertainment: Clapperboard,
  extraction: Pickaxe,
  retail: ShoppingCart,
  chemical_industries: FlaskConical,
};

/**
 * Render a sector type's identity icon. A stable module-level component (not a
 * component resolved during render), so it satisfies the static-components lint
 * rule and keeps the icon resolution in one place.
 */
export function SectorGlyph({ type, className }: { type: CorporationType; className?: string }) {
  const Icon = SECTOR_ICON[type] ?? Building2;
  return <Icon className={className} />;
}
