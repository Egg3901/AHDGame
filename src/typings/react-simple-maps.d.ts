declare module "react-simple-maps" {
  import { ReactNode } from "react";

  export interface ComposableMapProps {
    projection?: string;
    projectionConfig?: {
      scale?: number;
      center?: [number, number];
      rotate?: [number, number] | [number, number, number];
      translate?: [number, number];
      parallels?: [number, number];
      clipAngle?: number;
      [key: string]: unknown;
    };
    width?: number;
    height?: number;
    className?: string;
    style?: React.CSSProperties;
    children?: ReactNode;
  }

  export interface GeographiesProps {
    geography: string | object;
    children: (props: {
      geographies: Array<{
        rsmKey: string;
        id?: string | number;
        properties?: Record<string, unknown>;
        [key: string]: unknown;
      }>;
      outline?: object;
      borders?: object[];
      path: {
        (object: object): string | null;
        projection: () => (coordinates: [number, number]) => [number, number] | null;
        bounds: (object: object) => [[number, number], [number, number]];
        centroid: (object: object) => [number, number];
      };
      projection: (coordinates: [number, number]) => [number, number] | null;
    }) => ReactNode;
  }

  export interface GeographyProps {
    geography: object;
    fill?: string;
    fillOpacity?: number;
    stroke?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onMouseMove?: (e: React.MouseEvent) => void;
    onClick?: () => void;
  }

  export interface AnnotationProps {
    subject: [number, number];
    dx?: number;
    dy?: number;
    connectorProps?: React.SVGProps<SVGPathElement>;
    children?: ReactNode;
  }

  export interface ZoomableGroupProps {
    center?: [number, number];
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
    translateExtent?: [[number, number], [number, number]];
    children?: ReactNode;
  }

  export interface SphereProps {
    id?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
    className?: string;
  }

  export interface GraticuleProps {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    step?: [number, number];
    style?: React.CSSProperties;
    className?: string;
  }

  export function ComposableMap(props: ComposableMapProps): JSX.Element;
  export function Geographies(props: GeographiesProps): JSX.Element;
  export function Geography(props: GeographyProps): JSX.Element;
  export function Annotation(props: AnnotationProps): JSX.Element;
  export function ZoomableGroup(props: ZoomableGroupProps): JSX.Element;
  export function Sphere(props: SphereProps): JSX.Element;
  export function Graticule(props: GraticuleProps): JSX.Element;
}
