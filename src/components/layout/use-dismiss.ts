"use client";

import { useEffect, type RefObject } from "react";

type Refs = RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[];

/** Close a popover on Escape or on a click outside every element in `refs`. */
export function useDismiss(refs: Refs, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const list = Array.isArray(refs) ? refs : [refs];
    function onPointerDown(event: PointerEvent) {
      if (!list.some((ref) => ref.current?.contains(event.target as Node))) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [refs, open, onClose]);
}
