import type { CountryId } from "@/lib/constants/countries";
import { getNationalIdentity } from "@/lib/constants/nationalIdentity";
import { hexToRgba } from "./identityColor";

export type NationalRole = "public" | "official";

interface AuthoritySealProps {
  country: CountryId;
  /** `official` shows the ministry stamp; `public` shows the public-register stamp. */
  role?: NationalRole;
  /** Diameter in px. */
  size?: number;
  /** Override the seal text (defaults to the role's ministry / public label). */
  label?: string;
  className?: string;
}

const SERIF_CJK = "'Noto Serif SC', 'Noto Serif JP', 'Songti SC', serif";
const SERIF_MONO = "'Playfair Display', Georgia, 'Times New Roman', serif";
// CJK range — pick the CJK serif when the seal text contains Han characters.
const HAN = /[　-鿿]/;

/**
 * Round watermark authorization stamp (e.g. "经济部 · ECONOMY MINISTRY" for an
 * official session, "PUBLIC REGISTER" otherwise). Rotated slightly for a
 * hand-stamped feel. Colors derive from the country's fixed accent.
 */
export function AuthoritySeal({
  country,
  role = "public",
  size = 72,
  label,
  className = "",
}: AuthoritySealProps) {
  const id = getNationalIdentity(country);
  const text = label ?? (role === "official" ? id.ministry : id.publicSeal);

  return (
    <div
      aria-hidden
      className={`inline-flex items-center justify-center rounded-full text-center font-semibold uppercase ${className}`}
      style={{
        width: size,
        height: size,
        padding: size * 0.1,
        fontSize: size * 0.15,
        lineHeight: 1.05,
        transform: "rotate(-11deg)",
        fontFamily: HAN.test(text) ? SERIF_CJK : SERIF_MONO,
        color: hexToRgba(id.accent, 0.92),
        border: `2px solid ${hexToRgba(id.accent, 0.7)}`,
        boxShadow: `inset 0 0 0 2px ${hexToRgba(id.accent, 0.22)}`,
      }}
    >
      {text}
    </div>
  );
}
