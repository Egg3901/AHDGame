// Merge UK NUTS1 + IE region GeoJSON into one FeatureCollection, each feature
// tagged with properties.regionCode. Northern Ireland (from the UK NUTS dataset)
// is CLIPPED to the Republic's border (the two datasets are independently
// digitized and overlap) so the British Isles tile cleanly — no NI/Republic
// overlap (which covered Donegal's label) and a shared border that topojson.merge
// can dissolve when NI reunifies. Deterministic (sorted by regionCode).
//   Run: node scripts/maps/build-british-isles-geo.mjs
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import polygonClipping from "polygon-clipping";
const __d = path.dirname(fileURLToPath(import.meta.url));
const pub = (f) => path.resolve(__d, "../../public", f);

// NUTS1 code → internal region id (mirrors NUTS_TO_REGION in UKMapPaths.tsx).
const NUTS_TO_REGION = {
  UKC: "NEE",
  UKD: "NWE",
  UKE: "YHU",
  UKF: "EMI",
  UKG: "WMI",
  UKH: "EAE",
  UKI: "LON",
  UKJ: "SEE",
  UKK: "SWE",
  UKL: "WAL",
  UKM: "SCO",
  UKN: "NIR",
};

/** GeoJSON Polygon/MultiPolygon → polygon-clipping MultiPolygon coords. */
function toMP(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}

const uk = JSON.parse(readFileSync(pub("uk-nuts1.json"), "utf8"));
const ie = JSON.parse(readFileSync(pub("ie-regions.json"), "utf8"));

const ukOut = [];
for (const f of uk.features) {
  const nuts = String(f.id ?? f.properties?.id ?? "").toUpperCase();
  const code = NUTS_TO_REGION[nuts];
  if (!code) continue;
  ukOut.push({ ...f, id: code, properties: { ...(f.properties ?? {}), regionCode: code } });
}
const ieOut = [];
for (const f of ie.features) {
  const code = String(f.id ?? f.properties?.id ?? "");
  if (!code) continue;
  ieOut.push({ ...f, id: code, properties: { ...(f.properties ?? {}), regionCode: code } });
}

// Clip NI to the Republic's border: NI minus the union of all Republic regions.
// polygon-clipping emits GeoJSON-standard winding (CCW exterior), but these source
// datasets use the opposite (CW exterior — what d3-geo renders); a winding mismatch
// makes d3 draw the clipped region inverted (a black hole on the flat map, a broken
// seam on the globe). Reverse every ring so NI matches the dataset convention.
const nir = ukOut.find((f) => f.properties.regionCode === "NIR");
if (nir && ieOut.length) {
  const clipped = polygonClipping.difference(
    toMP(nir.geometry),
    ...ieOut.map((f) => toMP(f.geometry))
  );
  const rewound = clipped.map((poly) => poly.map((ring) => [...ring].reverse()));
  nir.geometry = { type: "MultiPolygon", coordinates: rewound };
  console.log(
    `clipped NIR against ${ieOut.length} Republic regions → ${rewound.length} polygon(s), rewound CW`
  );
}

const out = [...ukOut, ...ieOut].sort((a, b) =>
  a.properties.regionCode.localeCompare(b.properties.regionCode)
);
writeFileSync(
  pub("british-isles-regions.json"),
  JSON.stringify({ type: "FeatureCollection", features: out }) + "\n"
);
console.log(`wrote ${out.length} features: ${out.map((f) => f.properties.regionCode).join(", ")}`);
