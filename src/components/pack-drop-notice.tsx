"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Evento que dispara CofresView al soltar un drop. El watcher (montado global en
// app-chrome) lo escucha y abre el aviso de Florentino. Mismo estilo que el
// recap de resultados.
export const packDropEventName = "porra26-pack-drop";

export type PackDropItem = { title: string; image: string; qty: number };

// Aviso "Florentino te regala fichajes": modal con los sobres soltados + CTA a
// /cofres. En demo salta al soltar (mismo navegador); en real lo dispararía un
// watcher al entrar (mismo modal reutilizable).
export function PackDropWatcher() {
  const router = useRouter();
  const [items, setItems] = useState<PackDropItem[] | null>(null);

  useEffect(() => {
    const onDrop = (event: Event) => {
      const detail = (event as CustomEvent<{ items?: PackDropItem[] }>).detail;
      if (detail?.items?.length) setItems(detail.items);
    };
    window.addEventListener(packDropEventName, onDrop);
    return () => window.removeEventListener(packDropEventName, onDrop);
  }, []);

  if (!items) return null;
  const total = items.reduce((sum, item) => sum + item.qty, 0);
  const close = () => setItems(null);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pack-drop-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#151515] text-white shadow-2xl shadow-black/50 motion-safe:animate-[cofre-modal-pop_220ms_cubic-bezier(0.2,0.9,0.3,1)_both]">
        {/* Recorte con fondo transparente: se muestra ENTERO (object-contain) y
            se funde con el modal. Se intuye quién es, sin nombrarlo. */}
        <div className="relative mt-4 h-48 w-full">
          <Image
            src="/florentino.webp"
            alt=""
            fill
            sizes="448px"
            className="object-contain"
            priority
          />
          <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-md bg-[#ffd252]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ffd252] ring-1 ring-[#ffd252]/30">
            Fichajes
          </span>
        </div>

        <div className="px-5 pb-5 pt-1">
          <h3
            id="pack-drop-title"
            className="text-base font-bold tracking-tight sm:text-xl"
          >
            Es hora de renovar tu once
          </h3>
          <p className="mt-1.5 text-[13px] leading-5 text-zinc-300 sm:text-sm">
            Te traigo {total} sobre{total === 1 ? "" : "s"} de fichajes. Ábrelos
            y mete un crack en tu once.
          </p>

          <div className="mt-4 space-y-2">
            {items.map((item) => (
              <div
                key={item.title}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5"
              >
                <span className="relative block aspect-[818/1206] w-9 shrink-0 overflow-hidden rounded-md">
                  <Image
                    src={item.image}
                    alt=""
                    fill
                    sizes="36px"
                    className="object-contain"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold">
                  {item.title}
                </span>
                <span className="shrink-0 rounded-md bg-[#ffd252]/15 px-2 py-0.5 text-sm font-bold tabular-nums text-[#ffd252]">
                  ×{item.qty}
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              close();
              router.push("/cofres");
            }}
            className="mt-4 w-full rounded-lg bg-[#a7f600] px-4 py-3 text-sm font-bold text-black shadow-lg shadow-[#a7f600]/10 transition hover:bg-[#c7ff43]"
          >
            Abrir ahora
          </button>
        </div>
      </div>
    </div>
  );
}
