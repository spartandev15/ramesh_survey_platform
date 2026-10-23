"use client";

import { Compass } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type TourStep = { target: string; title: string; text: string };

const btn = "rounded-lg px-3 py-1.5 text-sm font-medium transition";
const primary = `${btn} bg-brand-navy-900 text-white hover:bg-brand-navy-700`;
const quiet = `${btn} text-gray-600 hover:bg-gray-100 hover:text-brand-navy-900`;
const noChanges = () => () => {};

function seen(key: string) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return true; // Storage blocked: never nag.
  }
}

/**
 * A guided tour of the page's features. The first visit offers it (Take the tour
 * or Skip); the button replays it any time. Each step points at the element
 * marked `data-tour="<target>"`; steps whose element is not on the page are left out.
 */
export function Tour({ id, steps }: { id: string; steps: TourStep[] }) {
  const key = `psg-tour:${id}`;
  // The server render never offers it; the browser checks whether this page was toured before.
  const firstVisit = !useSyncExternalStore(noChanges, () => seen(key), () => true);
  const [closed, setClosed] = useState(false);
  const [active, setActive] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const next = useRef<HTMLButtonElement>(null);
  const step = active[index];

  const finish = useCallback(() => {
    try {
      localStorage.setItem(key, "seen");
    } catch {}
    setClosed(true);
    setActive([]);
  }, [key]);

  function start() {
    setClosed(true);
    setIndex(0);
    setActive(steps.filter((s) => document.querySelector(`[data-tour="${s.target}"]`)));
  }

  useEffect(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    next.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("keydown", onKey);
    };
  }, [step, finish]);

  // The card sits below the highlighted part, above it, or at the bottom of the screen.
  const card = "fixed z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-gray-200 bg-white p-4 text-gray-800 shadow-2xl";
  let place: React.CSSProperties = { bottom: 16, right: 16 };
  if (step && rect) {
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - Math.min(352, window.innerWidth - 32) - 16));
    if (rect.bottom + 230 < window.innerHeight) place = { top: rect.bottom + 12, left };
    else if (rect.top > 230) place = { bottom: window.innerHeight - rect.top + 12, left };
    else place = { bottom: 16, left };
  }

  return (
    <>
      <button type="button" onClick={start} className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700">
        <Compass aria-hidden="true" className="size-4" />
        Take the tour
      </button>
      {firstVisit && !closed && (
        <div role="dialog" aria-label="Page tour" className={card} style={place}>
          <p className="text-sm font-semibold text-brand-navy-900">New to this page?</p>
          <p className="mt-1 text-sm text-gray-600">A short tour shows what each part does. It takes about a minute.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={finish} className={quiet}>
              Skip
            </button>
            <button type="button" onClick={start} className={primary}>
              Take the tour
            </button>
          </div>
        </div>
      )}
      {step && rect && (
        <>
          <div aria-hidden="true" className="pointer-events-none fixed z-40 rounded-2xl ring-2 ring-indigo-500 transition-all" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgb(15 23 42 / 0.45)" }} />
          <div role="dialog" aria-modal="false" aria-labelledby="tour-title" className={card} style={place}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">
              Step {index + 1} of {active.length}
            </p>
            <p id="tour-title" className="mt-1 text-sm font-semibold text-brand-navy-900">
              {step.title}
            </p>
            <p className="mt-1 text-sm text-gray-600">{step.text}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button type="button" onClick={finish} className={quiet}>
                Skip tour
              </button>
              <span className="flex gap-2">
                {index > 0 && (
                  <button type="button" onClick={() => setIndex(index - 1)} className={quiet}>
                    Back
                  </button>
                )}
                <button ref={next} type="button" onClick={() => (index + 1 < active.length ? setIndex(index + 1) : finish())} className={primary}>
                  {index + 1 < active.length ? "Next" : "Done"}
                </button>
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
