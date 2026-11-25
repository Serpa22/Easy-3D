/**
 * Utilidades compartidas por los componentes que viven en la capa superior del
 * navegador (`<dialog>` modal y elementos `popover`): detección de soporte,
 * animación de salida, posicionamiento de reserva y registro de modales abiertos.
 *
 * Solo se ejecutan en el navegador (se llaman desde efectos y manejadores).
 */

/* ---------- Detección de soporte ---------- */

export type TopLayerSupport = {
  /** API Popover (`popover`, `showPopover()`). */
  popover: boolean;
  /** Invoker Commands (`commandfor` / `command`). */
  invokers: boolean;
  /** Atributo `focusgroup` (navegación con flechas nativa). */
  focusgroup: boolean;
  /** CSS Anchor Positioning (`position-area`). */
  anchor: boolean;
};

/** En servidor (y durante la hidratación) se asume un navegador actual. */
const SERVER_SUPPORT: TopLayerSupport = { popover: true, invokers: true, focusgroup: true, anchor: true };
let support: TopLayerSupport | undefined;

export function getTopLayerSupport(): TopLayerSupport {
  support ??= {
    popover: "popover" in HTMLElement.prototype,
    invokers: "commandForElement" in HTMLButtonElement.prototype,
    focusgroup: "focusGroup" in HTMLElement.prototype,
    anchor: typeof CSS !== "undefined" && CSS.supports("position-area: block-end"),
  };
  return support;
}

export const getServerTopLayerSupport = () => SERVER_SUPPORT;
/** El soporte no cambia durante la sesión: suscripción vacía para `useSyncExternalStore`. */
export const subscribeNever = () => () => {};

/* ---------- Animación de salida ---------- */

let displayTransition: boolean | undefined;

/**
 * ¿Se puede transicionar `display`? Firefox acepta la sintaxis
 * `transition-behavior: allow-discrete` pero no la aplica, así que se comprueba
 * con un elemento de prueba en lugar de fiarse de `CSS.supports`.
 */
function canTransitionDisplay(): boolean {
  if (displayTransition !== undefined) return displayTransition;
  if (!window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) return false;
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  void getComputedStyle(probe).display;
  probe.style.display = "none";
  displayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return displayTransition;
}

/** La salida animada nativa necesita `overlay` y transición discreta de `display`. */
export function supportsTopLayerExit(): boolean {
  return Boolean(window.CSS?.supports?.("overlay", "auto")) && canTransitionDisplay();
}

/** Espera a que terminen las transiciones en curso del elemento (con tope de seguridad). */
export async function settle(element: Element, maxMs = 600): Promise<void> {
  const animations = element.getAnimations({ subtree: true });
  if (animations.length === 0) return;
  await Promise.race([
    Promise.allSettled(animations.map((a) => a.finished)),
    new Promise((resolve) => setTimeout(resolve, maxMs)),
  ]);
}

/**
 * Cierra un `<dialog>` modal dejando terminar su animación de salida.
 * Donde el navegador no sabe animar la salida de la capa superior se marca
 * `data-closing` (el CSS anima hacia el estado cerrado) y se cierra al acabar.
 */
export async function closeModalAnimated(dialog: HTMLDialogElement): Promise<void> {
  if (!dialog.open) {
    await settle(dialog);
    return;
  }
  if (supportsTopLayerExit()) {
    dialog.close();
    await settle(dialog);
    return;
  }
  dialog.setAttribute("data-closing", "");
  await settle(dialog);
  if (dialog.open) dialog.close();
  dialog.removeAttribute("data-closing");
}

/* ---------- Posicionamiento de reserva (sin CSS Anchor Positioning) ---------- */

export type FloatingPlacement = {
  side: "top" | "bottom";
  align: "start" | "end" | "center";
  /** Separación respecto al ancla, en px. */
  gap?: number;
};

/**
 * Coloca `floating` (con `position: fixed`) junto a `anchor`, dándole la vuelta
 * si no cabe y sin salirse de la ventana. Solo se usa cuando el navegador no
 * tiene `position-area`; con soporte, el CSS lo resuelve solo.
 */
export function placeFloating(floating: HTMLElement, anchor: Element, { side, align, gap = 4 }: FloatingPlacement) {
  const a = anchor.getBoundingClientRect();
  const f = floating.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const edge = 8;

  const below = a.bottom + gap;
  const above = a.top - gap - f.height;
  let top = side === "bottom" ? below : above;
  if (side === "bottom" && below + f.height > vh - edge && above >= edge) top = above;
  if (side === "top" && above < edge && below + f.height <= vh - edge) top = below;

  let left = align === "start" ? a.left : align === "end" ? a.right - f.width : a.left + (a.width - f.width) / 2;
  if (align === "start" && left + f.width > vw - edge) left = a.right - f.width;
  if (align === "end" && left < edge) left = a.left;

  floating.style.left = `${Math.round(Math.min(Math.max(edge, left), Math.max(edge, vw - edge - f.width)))}px`;
  floating.style.top = `${Math.round(Math.min(Math.max(edge, top), Math.max(edge, vh - edge - f.height)))}px`;
}

/* ---------- Registro de modales abiertos ---------- */

/**
 * Un `<dialog>` modal deja inerte todo lo que queda fuera de él, incluido el
 * contenedor de avisos (toasts). `Toaster` consulta este registro para
 * trasladarse dentro del modal que esté encima y seguir siendo visible,
 * clicable y anunciable.
 */
const modals: HTMLDialogElement[] = [];
const modalListeners = new Set<() => void>();

function emitModals() {
  for (const listener of modalListeners) listener();
}

export function registerModal(dialog: HTMLDialogElement) {
  if (modals.includes(dialog)) return;
  modals.push(dialog);
  emitModals();
}

export function unregisterModal(dialog: HTMLDialogElement) {
  const index = modals.indexOf(dialog);
  if (index === -1) return;
  modals.splice(index, 1);
  emitModals();
}

export function subscribeModals(listener: () => void) {
  modalListeners.add(listener);
  return () => {
    modalListeners.delete(listener);
  };
}

export const getTopModal = (): HTMLDialogElement | null => modals.at(-1) ?? null;
export const getServerTopModal = (): HTMLDialogElement | null => null;
