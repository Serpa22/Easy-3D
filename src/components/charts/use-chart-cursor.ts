"use client";

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Posición activa de un gráfico (la columna o el punto bajo el cursor).
 *
 * - Puntero: la posición sale de la X del puntero, así que basta con estar
 *   cerca de la marca; en táctil se queda fija hasta tocar fuera.
 * - Teclado: el gráfico es UNA sola parada de tabulación (la última posición);
 *   ← → recorren, Inicio / Fin saltan a los extremos y Escape cierra la lectura.
 */
export function useChartCursor(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const [roving, setRoving] = useState<number | null>(null);
  const hits = useRef<(SVGRectElement | null)[]>([]);
  const root = useRef<SVGSVGElement | null>(null);

  const last = Math.max(0, count - 1);
  const tabStop = Math.min(roving ?? last, last);
  const current = active !== null && active < count ? active : null;
  const open = current !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
    };
    const onDown = (event: globalThis.PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  function focusAt(index: number) {
    const next = Math.min(Math.max(index, 0), last);
    setRoving(next);
    hits.current[next]?.focus();
  }

  /** Props de la zona interactiva de la posición `index`. */
  function hitProps(index: number) {
    return {
      ref: (element: SVGRectElement | null) => {
        hits.current[index] = element;
      },
      tabIndex: index === tabStop ? 0 : -1,
      onFocus: (event: FocusEvent<SVGRectElement>) => {
        // el clic con ratón también enfoca: ahí manda el puntero
        if (event.currentTarget.matches(":focus-visible")) setActive(index);
        setRoving(index);
      },
      onBlur: () => setActive((value) => (value === index ? null : value)),
      onKeyDown: (event: KeyboardEvent<SVGRectElement>) => {
        if (event.key === "ArrowRight") focusAt(index + 1);
        else if (event.key === "ArrowLeft") focusAt(index - 1);
        else if (event.key === "Home") focusAt(0);
        else if (event.key === "End") focusAt(last);
        else return;
        event.preventDefault();
      },
    };
  }

  /** Props del grupo que contiene las zonas: traduce la X del puntero a una posición. */
  function pointerProps(indexAt: (x: number) => number) {
    const update = (event: PointerEvent<SVGGElement>) => {
      const svg = root.current;
      if (!svg) return;
      const index = indexAt(event.clientX - svg.getBoundingClientRect().left);
      setActive(Math.min(Math.max(index, 0), last));
    };
    return {
      onPointerMove: update,
      onPointerDown: update,
      onPointerLeave: (event: PointerEvent<SVGGElement>) => {
        // en táctil el puntero «sale» al levantar el dedo: la lectura debe quedarse
        if (event.pointerType === "mouse") setActive(null);
      },
    };
  }

  return { active: current, rootRef: root, hitProps, pointerProps };
}
