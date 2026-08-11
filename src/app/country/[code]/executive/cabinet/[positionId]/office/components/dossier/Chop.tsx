export function Chop({
  glyph,
  serif,
  sealImage,
  size = 76,
  className = "",
}: {
  glyph: string;
  serif: "cjk" | "mono";
  sealImage?: string | null;
  size?: number;
  className?: string;
}) {
  if (sealImage) {
    return (
      <div
        className={`chop shrink-0 overflow-hidden bg-white ${className}`}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sealImage} alt="Department seal" className="h-full w-full object-contain p-1.5" />
      </div>
    );
  }
  const len = glyph.length;
  const fs =
    serif === "cjk" ? size * 0.5 : len >= 3 ? size * 0.26 : len >= 2 ? size * 0.34 : size * 0.46;
  return (
    <div
      className={`chop shrink-0 ${serif === "cjk" ? "cjk" : "mono-seal"} ${className}`}
      style={{ width: size, height: size, fontSize: fs }}
    >
      {glyph}
    </div>
  );
}
