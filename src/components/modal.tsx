"use client";

import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";

/**
 * A button that opens a popup. Uses the browser's own <dialog>: focus moves
 * into it, Escape closes it and focus returns to the button (SR-39).
 */
export function Modal({
  label,
  buttonClass,
  buttonTitle,
  title,
  children,
  onOpen,
}: {
  label: ReactNode;
  buttonClass: string;
  buttonTitle?: string;
  title: string;
  children: ReactNode;
  onOpen?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        title={buttonTitle}
        className={buttonClass}
        onClick={() => {
          onOpen?.();
          ref.current?.showModal();
        }}
      >
        {label}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        // A click on the dimmed backdrop closes it too.
        onClick={(e) => e.target === ref.current && ref.current.close()}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-brand-navy-900">{title}</h2>
          <form method="dialog">
            <button aria-label="Close" className="rounded-lg p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
              <X className="size-5" aria-hidden="true" />
            </button>
          </form>
        </div>
        <div className="px-5 py-4">{children}</div>
      </dialog>
    </>
  );
}

/** Closes the popup it sits in. */
export function CloseButton({ children, className }: { children: ReactNode; className: string }) {
  return (
    <form method="dialog" className="contents">
      <button className={className}>{children}</button>
    </form>
  );
}
