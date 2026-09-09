'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { placeAnchored, type AnchoredSide } from '../../lib/appearance/placement.ts';

export type Translate = (en: string, zh: string) => string;

export type AnchoredPopoverProps = {
  id: string;
  /** The element this popover tracks. A ref rather than a rect, because tracking means re-measuring it as it moves. */
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
  preferred?: AnchoredSide;
  children: ReactNode;
  t: Translate;
};

const GAP = 8;
const MARGIN = 16;

/**
 * A non-modal panel anchored to a trigger element, used by the context menu,
 * the searchable select's listbox and the colour picker's own popovers.
 *
 * This is a plain `<dialog open>`, the same shape `components/search-
 * workbench.tsx`'s own popover already uses in this project, rather than the
 * newer combined `popover` attribute: driving `popover` correctly needs
 * `showPopover()`/`hidePopover()` calls kept in sync with `open`, and getting
 * that wrong renders an invisible panel with no visible error. A `position:
 * fixed` dialog with its own elevation, positioned by `lib/appearance/
 * placement.ts`, is the version of this project already ships and already
 * knows works.
 *
 * Position is measured, not assumed: the anchor and the panel are both watched
 * with a `ResizeObserver`, window scroll is watched in the capture phase (scroll
 * does not bubble, but capture-phase listeners on `window` still see scroll
 * events fired anywhere in the tree), and every one of those re-measurements is
 * folded through one rAF so a burst of them repaints once, not repeatedly.
 */
export default function AnchoredPopover({ id, anchor, open, onClose, label, preferred = 'bottom', children }: AnchoredPopoverProps) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    setPosition(null);
    const anchorEl = anchor.current;
    const panelEl = panelRef.current;
    if (!anchorEl || !panelEl) return;

    const reposition = () => {
      const anchorRect = anchorEl.getBoundingClientRect();
      const panelRect = panelEl.getBoundingClientRect();
      const result = placeAnchored({
        anchor: { top: anchorRect.top, left: anchorRect.left, width: anchorRect.width, height: anchorRect.height },
        panel: { width: panelRect.width, height: panelRect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        preferred,
        gap: GAP,
        margin: MARGIN,
      });
      setPosition({ top: result.top, left: result.left });
    };

    reposition();
    let frame = 0;
    const scheduleReposition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(reposition);
    };

    const resizeObserver = new ResizeObserver(scheduleReposition);
    resizeObserver.observe(anchorEl);
    resizeObserver.observe(panelEl);
    // Capture phase: scroll does not bubble, but a capture listener on window
    // still sees it fire on any scrollable ancestor between here and the target.
    window.addEventListener('scroll', scheduleReposition, true);
    window.addEventListener('resize', scheduleReposition);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('scroll', scheduleReposition, true);
      window.removeEventListener('resize', scheduleReposition);
    };
  }, [open, anchor, preferred]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, anchor, onClose]);

  if (!open) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
    anchor.current?.focus();
  };

  return (
    <dialog
      id={id}
      ref={panelRef}
      open
      className="appearance-popover"
      aria-label={label}
      aria-modal="false"
      data-ui="appearance.popover"
      style={position ? { top: `${position.top}px`, left: `${position.left}px`, visibility: 'visible' } : { top: 0, left: 0, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
    >
      {children}
    </dialog>
  );
}
