"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { MAP_SVG } from "./mapSvg";
import type { BlocId } from "./blocs";
import { REGION_SHARDS } from "@/lib/maps/regionManifest";
import { computeRegionBlobs } from "@/lib/maps/regionOverlay";
import { WORLD_OVERLAY_OWNER_FOLD } from "@/lib/maps/germanyGeometry";
import { mapNameFor, blocFor, blobPathD } from "./regionOverlayBridge";

export type MapColors = { fill: string; stroke: string; strokeWidth: string };

type Props = {
  /** Returns the fill/stroke for a country path given its name + bloc + state. */
  colorOf: (name: string, bloc: BlocId, st: { selected: boolean; hovered: boolean }) => MapColors;
  /** When true, paths emit hover/click. When false, paths are inert (overlays handle interaction). */
  interactive?: boolean;
  selected?: string | null;
  hovered?: string | null;
  /** Hover coords are relative to the map box. `name` is null on leave; `bloc` is the path's data-bloc. */
  onHoverNation?: (name: string | null, bloc: BlocId, x: number, y: number) => void;
  onClickNation?: (name: string, bloc: BlocId) => void;
  /** Radial vignette overlay (pointer-events none). */
  vignette?: string;
  /** Inner box background. */
  background?: string;
  /** Absolute-positioned overlays (pins, labels, tooltips, detail panels). */
  children?: ReactNode;
};

const DEFAULT_VIGNETTE = "radial-gradient(130% 95% at 50% 35%,transparent 60%,rgba(8,8,12,.55))";

/**
 * Shared world map for the situation-room boards. Injects the bloc-map SVG once,
 * colors each country path via `colorOf` (re-applied when selection/hover
 * changes), and — when `interactive` — resolves the hovered/clicked country from
 * its `data-name`. Page-specific overlays are rendered as children above the map.
 */
export function WorldBlocMap({
  colorOf,
  interactive = false,
  selected = null,
  hovered = null,
  onHoverNation,
  onClickNation,
  vignette = DEFAULT_VIGNETTE,
  background = "#0c0c13",
  children,
}: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const injectedRef = useRef(false);

  // Keep the latest callbacks/colorer in refs so the mount-only listener effect
  // never reads stale closures.
  const colorOfRef = useRef(colorOf);
  const hoverCbRef = useRef(onHoverNation);
  const clickCbRef = useRef(onClickNation);
  const selRef = useRef(selected);
  const hovRef = useRef(hovered);
  colorOfRef.current = colorOf;
  hoverCbRef.current = onHoverNation;
  clickCbRef.current = onClickNation;
  selRef.current = selected;
  hovRef.current = hovered;

  function paint() {
    const root = mapRef.current;
    if (!root) return;
    root.querySelectorAll<SVGPathElement>("path").forEach((p) => {
      const name = p.getAttribute("data-name") ?? "";
      const bloc = (p.getAttribute("data-bloc") as BlocId | null) ?? "other";
      const c = colorOfRef.current(name, bloc, {
        selected: name === selRef.current,
        hovered: name === hovRef.current,
      });
      p.style.fill = c.fill;
      p.style.stroke = c.stroke;
      p.style.strokeWidth = c.strokeWidth;
      p.style.cursor = interactive ? "pointer" : "default";
    });
  }

  // Inject the SVG once + wire listeners (mount only).
  useEffect(() => {
    const root = mapRef.current;
    if (!root || injectedRef.current) return;
    root.innerHTML = MAP_SVG;
    injectedRef.current = true;
    paint();

    // Live region-ownership overlay (best-effort): inject one blob per owner so
    // the map geometry reflects territory transfers (a Land moved to an East power
    // turns red), and hide the base country an overlay now draws. No splits → the
    // static map is untouched.
    let cancelled = false;
    (async () => {
      try {
        const [pcMod, ownResp, ...shardGeos] = await Promise.all([
          import("polygon-clipping"),
          fetch("/api/maps/region-ownership", { cache: "no-store" }).then((r) => r.json()),
          ...REGION_SHARDS.map((s) => fetch(s.url, { cache: "no-store" }).then((r) => r.json())),
        ]);
        if (cancelled || !mapRef.current) return;
        const ownership: Record<string, string> = ownResp?.ownership ?? {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pc: any = (pcMod as any).default ?? pcMod;
        const { blobs, coveredBases } = computeRegionBlobs(
          REGION_SHARDS.map((s, i) => ({
            baseCountryIds: s.baseCountryIds,
            features: shardGeos[i]?.features ?? [],
          })),
          ownership,
          WORLD_OVERLAY_OWNER_FOLD,
          pc
        );
        if (blobs.size === 0) return; // no splits → leave the static map as-is
        const host = mapRef.current;
        const g = host.querySelector("svg > g") ?? host.querySelector("svg");
        for (const cid of coveredBases) {
          const name = mapNameFor(cid);
          if (!name) continue;
          host
            .querySelectorAll<SVGPathElement>(`path[data-name="${name}"]`)
            .forEach((p) => (p.style.display = "none"));
        }
        for (const [owner, multiPoly] of blobs) {
          const d = blobPathD(multiPoly);
          if (!d) continue;
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", d);
          path.setAttribute("data-name", mapNameFor(owner) ?? owner);
          path.setAttribute("data-bloc", blocFor(owner));
          path.setAttribute("data-region-overlay", "1");
          g?.appendChild(path);
        }
        paint();
      } catch {
        // best-effort — the static map still renders without the overlay
      }
    })();

    if (!interactive) {
      return () => {
        cancelled = true;
      };
    }
    const onMove = (e: MouseEvent) => {
      const path = (e.target as Element)?.closest?.("path");
      const name = path?.getAttribute("data-name") ?? null;
      const bloc = (path?.getAttribute("data-bloc") as BlocId | null) ?? "other";
      const r = root.getBoundingClientRect();
      hoverCbRef.current?.(name, bloc, e.clientX - r.left, e.clientY - r.top);
    };
    const onLeave = () => hoverCbRef.current?.(null, "other", 0, 0);
    const onClick = (e: MouseEvent) => {
      const path = (e.target as Element)?.closest?.("path");
      const name = path?.getAttribute("data-name");
      const bloc = (path?.getAttribute("data-bloc") as BlocId | null) ?? "other";
      if (name) clickCbRef.current?.(name, bloc);
    };
    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    root.addEventListener("click", onClick);
    return () => {
      cancelled = true;
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
      root.removeEventListener("click", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repaint when selection/hover (or the colorer) changes.
  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, hovered, colorOf]);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #20202c",
        background,
        aspectRatio: "1000 / 394",
      }}
    >
      <div ref={mapRef} style={{ position: "absolute", inset: 0 }} />
      <div
        style={{ position: "absolute", inset: 0, background: vignette, pointerEvents: "none" }}
      />
      {children}
    </div>
  );
}
