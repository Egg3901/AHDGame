declare module "topojson-server" {
  import type { GeometryCollection, Topology } from "topojson-specification";

  export function topology(
    objects: Record<string, GeometryCollection | GeoJSON.FeatureCollection>,
    quantization?: number
  ): Topology;
}
