"use client";

import { SubdivisionMap, type SubdivisionDatum } from "./SubdivisionMap";

interface CountyData {
  fips: string;
  name: string;
  path: string;
  votes: Record<string, number>;
  margin: number;
  winner: string;
  cookPVI: number;
}

interface CountyMapProps {
  viewBox: string;
  counties: CountyData[];
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
  showBackgroundMap?: boolean;
  /** State abbreviation → EV color (e.g. "CA" → "#3B82F6"). Colors other states by EV result. */
  backgroundStateColors?: Record<string, string>;
  /** When true, uses the full national US viewBox (0 0 960 600) for context. */
  nationalView?: boolean;
}

/** Thin adapter over SubdivisionMap keeping the legacy US county prop shape. */
export function CountyMap({ counties, ...rest }: CountyMapProps) {
  const subdivisions: SubdivisionDatum[] = counties.map((c) => ({
    id: c.fips,
    name: c.name,
    path: c.path,
    votes: c.votes,
    margin: c.margin,
    winner: c.winner,
    leanScalar: c.cookPVI,
  }));
  return <SubdivisionMap subdivisions={subdivisions} {...rest} />;
}
