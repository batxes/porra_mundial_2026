"use client";

import { useEffect } from "react";

import { CircularBracketPanel } from "@/components/circular-bracket-demo-view";

export function WorldCupBracketModal({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-3 py-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Cuadro del Mundial"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-white/12 bg-[#070707] p-4 shadow-2xl shadow-black sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#a7f600]">
              Fase final
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-white">
              Cuadro del Mundial
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 text-lg font-bold text-zinc-300 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a7f600]"
            aria-label="Cerrar cuadro mundial"
          >
            x
          </button>
        </div>
        <CircularBracketPanel unframed />
      </div>
    </div>
  );
}
