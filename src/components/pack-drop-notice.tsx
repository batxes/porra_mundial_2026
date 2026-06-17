"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase";

// Evento que dispara CofresView al soltar un drop. El watcher (montado global en
// app-chrome) lo escucha y abre el aviso de Florentino. Mismo estilo que el
// recap de resultados.
export const packDropEventName = "porra26-pack-drop";

export type PackDropItem = { title: string; image: string; qty: number };

type Variant = "drop" | "launch" | "premier";

// Aviso ÚNICO de lanzamiento de las cartas (3 sobres de bienvenida).
const launchSeenKey = "porra26_cards_launch_seen";
const LAUNCH_ITEMS: PackDropItem[] = [
  { title: "Sobre diario", image: "/sobre.webp", qty: 1 },
  { title: "Sobre Promesas", image: "/sobre21.webp", qty: 1 },
  { title: "Sobre Estrellas", image: "/sobre-estrellas.webp", qty: 1 },
];

// Aviso ÚNICO "¡Palanca!": sobre Premier de compensación. No sale si el usuario
// ya lo abrió (consulta user_cards → cross-dispositivo).
const premierSeenKey = "porra26_premier_launch_seen";
const PREMIER_ITEMS: PackDropItem[] = [
  { title: "Sobre Premier", image: "/sobre-premier.webp", qty: 1 },
];

// Otros modales prioritarios a los que ceder el paso (no solaparse).
const blockingSelectorBase =
  '[aria-labelledby="results-recap-title"], [aria-labelledby="cofres-intro-title"]';

// Modal con sobres + CTA a /cofres. Tres variantes: (a) LANZAMIENTO (Florentino,
// a todos una vez), (b) PALANCA (Laporta, sobre Premier de compensación, a todos
// una vez) y (c) drops que suelta el admin (evento `packDropEventName`).
export function PackDropWatcher({
  launchReady = false,
}: {
  launchReady?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<PackDropItem[] | null>(null);
  const [variant, setVariant] = useState<Variant>("drop");

  useEffect(() => {
    const onDrop = (event: Event) => {
      const detail = (event as CustomEvent<{ items?: PackDropItem[] }>).detail;
      if (detail?.items?.length) {
        setVariant("drop");
        setItems(detail.items);
      }
    };
    window.addEventListener(packDropEventName, onDrop);
    return () => window.removeEventListener(packDropEventName, onDrop);
  }, []);

  // Lanzamiento de las cartas: una vez por navegador. No sale si ya tienes
  // cartas (cross-dispositivo). Cede el paso al recap de resultados y al tutorial.
  useEffect(() => {
    if (!launchReady) return;
    let seen = true;
    try {
      seen = window.localStorage.getItem(launchSeenKey) === "1";
    } catch {
      seen = true;
    }
    if (seen) return;

    let cancelled = false;
    let timer: number;
    const markSeen = () => {
      try {
        window.localStorage.setItem(launchSeenKey, "1");
      } catch {
        // ignoramos fallos de storage
      }
    };
    const show = () => {
      if (cancelled) return;
      if (document.querySelector(blockingSelectorBase)) {
        timer = window.setTimeout(show, 800);
        return;
      }
      setVariant("launch");
      setItems(LAUNCH_ITEMS);
    };

    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const supabase = getSupabaseBrowserClient() as any;
        if (supabase) {
          const { data } = await supabase
            .from("user_cards")
            .select("drop_id")
            .limit(1);
          if (cancelled) return;
          if (Array.isArray(data) && data.length > 0) {
            markSeen();
            return;
          }
        }
      } catch {
        // si falla la consulta, mejor mostrar el aviso que ocultarlo
      }
      if (cancelled) return;
      timer = window.setTimeout(show, 800);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [launchReady]);

  // Palanca (sobre Premier de compensación): una vez por navegador. No sale si ya
  // abriste el Premier (user_cards `premier-%`). Cede el paso a los otros modales,
  // incluido el de lanzamiento (mismo `pack-drop-title`), para no solaparse.
  useEffect(() => {
    if (!launchReady) return;
    let seen = true;
    try {
      seen = window.localStorage.getItem(premierSeenKey) === "1";
    } catch {
      seen = true;
    }
    if (seen) return;

    let cancelled = false;
    let timer: number;
    const markSeen = () => {
      try {
        window.localStorage.setItem(premierSeenKey, "1");
      } catch {
        // ignoramos fallos de storage
      }
    };
    const show = () => {
      if (cancelled) return;
      if (
        document.querySelector(
          blockingSelectorBase + ', [aria-labelledby="pack-drop-title"]',
        )
      ) {
        timer = window.setTimeout(show, 800);
        return;
      }
      setVariant("premier");
      setItems(PREMIER_ITEMS);
    };

    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const supabase = getSupabaseBrowserClient() as any;
        if (supabase) {
          const { data } = await supabase
            .from("user_cards")
            .select("drop_id")
            .like("drop_id", "premier-%")
            .limit(1);
          if (cancelled) return;
          if (Array.isArray(data) && data.length > 0) {
            markSeen();
            return;
          }
        }
      } catch {
        // si falla la consulta, mejor mostrar el aviso que ocultarlo
      }
      if (cancelled) return;
      timer = window.setTimeout(show, 1200);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [launchReady]);

  if (!items) return null;
  const total = items.reduce((sum, item) => sum + item.qty, 0);
  const isPremier = variant === "premier";
  const close = () => {
    setItems(null);
    try {
      if (variant === "premier") {
        window.localStorage.setItem(premierSeenKey, "1");
      } else if (variant === "launch") {
        window.localStorage.setItem(launchSeenKey, "1");
      }
    } catch {
      // ignoramos fallos de storage
    }
  };

  const title = isPremier
    ? "¡Palanca!"
    : variant === "launch"
      ? "¡Es hora de renovar tu once!"
      : "Es hora de renovar tu once";
  const subtitle = isPremier
    ? "Roba un jugador de la premier."
    : variant === "launch"
      ? "Tienes 3 sobres de bienvenida esperando. ¡Suerte!"
      : `Te traigo ${total} sobre${total === 1 ? "" : "s"} de fichajes. Ábrelos y mete un crack en tu once.`;

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
            src={isPremier ? "/laporta.webp" : "/florentino.webp"}
            alt=""
            fill
            sizes="448px"
            className="object-contain"
            priority
          />
          <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-md bg-[#ffd252]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ffd252] ring-1 ring-[#ffd252]/30">
            {isPremier ? "Premier" : "Fichajes"}
          </span>
        </div>

        <div className="px-5 pb-5 pt-1">
          <h3
            id="pack-drop-title"
            className="text-base font-bold tracking-tight sm:text-xl"
          >
            {title}
          </h3>
          <p className="mt-1.5 text-[13px] leading-5 text-zinc-300 sm:text-sm">
            {subtitle}
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
