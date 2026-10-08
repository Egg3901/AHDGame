"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { IDENTITY_VIEW, panBy, wheelFactor, zoomAt, zoomStep, type MapView } from "./mapView";

/** Pointer travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

interface Options {
  svgRef: RefObject<SVGSVGElement | null>;
  /** Pan and zoom are inert, and nothing is captured, while this is false. */
  enabled: boolean;
  /** Screen pixels per map unit at zoom 1. */
  scale: number;
  width: number;
  height: number;
}

/**
 * Drag, wheel and pinch for the map. Everything that could capture the page's
 * own scrolling is attached only while `enabled`, so a locked map never
 * intercepts a wheel or a touch.
 */
export function usePanZoom({ svgRef, enabled, scale, width, height }: Options) {
  const [view, setView] = useState<MapView>(IDENTITY_VIEW);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ startX: 0, startY: 0, moved: false, pinch: 0 });
  const dragged = useRef(false);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = (e.clientX - rect.left) / scale;
      const py = (e.clientY - rect.top) / scale;
      setView((v) => zoomAt(v, wheelFactor(e.deltaY, e.deltaMode), px, py, width, height));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgRef, enabled, scale, width, height]);

  const onPointerDown = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      if (!enabled) return;
      dragged.current = false;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture.current;
      if (pointers.current.size === 1) {
        g.startX = e.clientX;
        g.startY = e.clientY;
        g.moved = false;
        g.pinch = 0;
      } else if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        g.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        g.moved = true;
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    },
    [enabled]
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      const prev = pointers.current.get(e.pointerId);
      if (!enabled || !prev) return;
      const g = gesture.current;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (g.pinch > 0 && dist > 0) {
          const rect = e.currentTarget.getBoundingClientRect();
          const mx = ((a.x + b.x) / 2 - rect.left) / scale;
          const my = ((a.y + b.y) / 2 - rect.top) / scale;
          const factor = dist / g.pinch;
          setView((v) => zoomAt(v, factor, mx, my, width, height));
        }
        g.pinch = dist;
        return;
      }
      if (!g.moved) {
        if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD_PX) return;
        g.moved = true;
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      const dx = (e.clientX - prev.x) / scale;
      const dy = (e.clientY - prev.y) / scale;
      setView((v) => panBy(v, dx, dy, width, height));
    },
    [enabled, scale, width, height]
  );

  const endPointer = useCallback((e: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size < 2) gesture.current.pinch = 0;
    if (pointers.current.size === 0) {
      if (gesture.current.moved) dragged.current = true;
      gesture.current.moved = false;
      setDragging(false);
    }
  }, []);

  /** True once after a drag, so the click that ends it does not select a state. */
  const consumeDrag = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);

  const zoomBy = useCallback(
    (direction: 1 | -1) => setView((v) => zoomStep(v, direction, width, height)),
    [width, height]
  );
  const reset = useCallback(() => setView(IDENTITY_VIEW), []);

  return {
    // A locked map always shows the whole country.
    view: enabled ? view : IDENTITY_VIEW,
    dragging,
    zoomBy,
    reset,
    consumeDrag,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
    },
  };
}
