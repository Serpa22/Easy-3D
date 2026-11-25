"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tamaño de un elemento, al día con ResizeObserver.
 *
 * Devuelve `null` en el servidor y hasta que el elemento existe; el primer valor
 * llega antes del primer pintado en cliente, así que no hay salto de layout.
 * `box: "content"` mide el interior (para dibujar dentro); `"border"` la caja entera.
 */
export function useElementSize<T extends HTMLElement>(
  box: "content" | "border" = "content",
): [(element: T | null) => void, ElementSize | null] {
  const [element, setElement] = useState<T | null>(null);

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!element || typeof ResizeObserver === "undefined") return () => {};
      const observer = new ResizeObserver(notify);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [element],
  );

  const width = useSyncExternalStore(
    subscribe,
    () => (element ? (box === "content" ? element.clientWidth : element.offsetWidth) : 0),
    () => 0,
  );
  const height = useSyncExternalStore(
    subscribe,
    () => (element ? (box === "content" ? element.clientHeight : element.offsetHeight) : 0),
    () => 0,
  );

  return [setElement, width > 0 ? { width, height } : null];
}
