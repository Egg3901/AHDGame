// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeoPermissibleObjects = any;

type RawProjection = (lambda: number, phi: number) => [number, number];

declare module "d3-geo" {
  export interface GeoProjection {
    (point: [number, number]): [number, number] | null;
    scale(): number;
    scale(scale: number): this;
    translate(): [number, number];
    translate(translate: [number, number]): this;
    rotate(): [number, number, number];
    rotate(angles: [number, number, number]): this;
    clipAngle(): number | null;
    clipAngle(angle: number | null): this;
    precision(): number;
    precision(precision: number): this;
    fitSize(size: [number, number], object: GeoPermissibleObjects): this;
  }

  export function geoEqualEarth(): GeoProjection;
  export function geoOrthographic(): GeoProjection;
  export function geoProjection(raw: RawProjection): GeoProjection;
  export function geoPath(
    projection?: GeoProjection
  ): (object: GeoPermissibleObjects) => string | null;
  export function geoCentroid(object: GeoPermissibleObjects): [number, number];
  /** Spherical area of a GeoJSON object in steradians (0…4π). */
  export function geoArea(object: GeoPermissibleObjects): number;
  /**
   * Spherical bounding box, `[[west, south], [east, north]]` in degrees.
   *
   * SPHERICAL, not the min/max of the coordinates: the arc between two vertices
   * at the same latitude bows poleward, so a shape cut along a parallel reports
   * an extent slightly past it on the equator-facing side.
   */
  export function geoBounds(object: GeoPermissibleObjects): [[number, number], [number, number]];
  export function geoGraticule10(): GeoPermissibleObjects;

  export const geoEqualEarthRaw: RawProjection;
  export const geoOrthographicRaw: RawProjection;
}
