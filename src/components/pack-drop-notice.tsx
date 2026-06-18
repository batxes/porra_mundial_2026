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

// Aviso ÚNICO de lanzamiento de las cartas (sobres de bienvenida por defecto).
const launchSeenKey = "porra26_cards_launch_seen";
const LAUNCH_ITEMS: PackDropItem[] = [
  { title: "Sobre diario", image: "/sobre.webp", qty: 1 },
  { title: "Sobre Promesas", image: "/sobre21.webp", qty: 1 },
  { title: "Sobre Estrellas", image: "/sobre-estrellas.webp", qty: 1 },
  { title: "Sobre Defensas", image: "/sobre-defensas.webp", qty: 1 },
  { title: "Sobre Mediocentros", image: "/sobre-medios.webp", qty: 1 },
  { title: "Sobre Delanteros", image: "/sobre-delanteros.webp", qty: 1 },
];

// Aviso ÚNICO "¡Palanca!": sobre Premier de compensación. No sale si el usuario
// ya lo abrió (consulta user_cards → cross-dispositivo).
const premierSeenKey = "porra26_premier_launch_seen";
const PREMIER_ITEMS: PackDropItem[] = [
  { title: "Sobre Premier", image: "/sobre-premier.webp", qty: 1 },
];

// Bienvenida para usuarios nuevos: sobres por defecto + Premier de regalo.
const LAUNCH_PLUS_PREMIER_ITEMS: PackDropItem[] = [
  ...LAUNCH_ITEMS,
  ...PREMIER_ITEMS,
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

  // UN solo aviso por usuario, mutuamente excluyente (nunca los dos):
  //  - Quien NO ha visto el lanzamiento y NO tiene cartas (nuevo) → bienvenida
  //    (Florentino) con los sobres por defecto, Premier incluido de regalo.
  //  - Quien ya vio el lanzamiento O ya tiene cartas (entró antes) → solo el
  //    Premier (Laporta), si no lo ha abierto ya.
  // Una sola consulta a Supabase decide; cede el paso al recap y al tutorial.
  useEffect(() => {
    if (!launchReady) return;
    let launchSeen = true;
    let premierSeen = true;
    try {
      launchSeen = window.localStorage.getItem(launchSeenKey) === "1";
      premierSeen = window.localStorage.getItem(premierSeenKey) === "1";
    } catch {
      return; // sin storage, no insistimos
    }
    if (launchSeen && premierSeen) return;

    let cancelled = false;
    let timer: number;
    const show = (nextVariant: Variant, list: PackDropItem[]) => {
      if (cancelled) return;
      if (document.querySelector(blockingSelectorBase)) {
        timer = window.setTimeout(() => show(nextVariant, list), 800);
        return;
      }
      setVariant(nextVariant);
      setItems(list);
    };

    void (async () => {
      let hasCards = false;
      let hasPremier = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const supabase = getSupabaseBrowserClient() as any;
        if (supabase) {
          const { data } = await supabase.from("user_cards").select("drop_id");
          if (Array.isArray(data)) {
            hasCards = data.length > 0;
            hasPremier = data.some(
              (row: { drop_id?: unknown }) =>
                typeof row.drop_id === "string" &&
                row.drop_id.startsWith("premier-"),
            );
          }
        }
      } catch {
        // si falla, seguimos con lo que diga localStorage
      }
      if (cancelled) return;

      if (!launchSeen && !hasCards) {
        // Nuevo: bienvenida con los sobres por defecto (incluye el Premier).
        timer = window.setTimeout(
          () => show("launch", LAUNCH_PLUS_PREMIER_ITEMS),
          800,
        );
      } else if (!premierSeen && !hasPremier) {
        // Entró antes: solo el Premier (Laporta) de compensación.
        timer = window.setTimeout(() => show("premier", PREMIER_ITEMS), 800);
      } else {
        // Ya está todo servido (tiene cartas/Premier): marcamos para no volver a
        // consultar en cada visita.
        try {
          window.localStorage.setItem(launchSeenKey, "1");
          window.localStorage.setItem(premierSeenKey, "1");
        } catch {
          // ignoramos fallos de storage
        }
      }
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
      // El lanzamiento (bienvenida) ya incluye el Premier, y el Premier implica
      // haber pasado el lanzamiento: en ambos casos marcamos los dos para que no
      // salga el otro aviso después. El drop de admin no marca nada.
      if (variant === "launch" || variant === "premier") {
        window.localStorage.setItem(launchSeenKey, "1");
        window.localStorage.setItem(premierSeenKey, "1");
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
    ? "Por el fallo de la app antes, roba un jugador de la Premier."
    : variant === "launch"
      ? `Tienes ${total} sobres esperando, ¡con uno de la Premier de regalo! ¡Suerte!`
      : `Te traigo ${total} sobre${total === 1 ? "" : "s"} de fichajes. Ábrelos y mete un crack en tu once.`;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 pb-6 pt-16 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pack-drop-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151515] p-5 text-white shadow-2xl shadow-black/50 motion-safe:animate-[cofre-modal-pop_220ms_cubic-bezier(0.2,0.9,0.3,1)_both]">
        {/* Cabecera estilo recap de resultados: texto a la izquierda y la imagen
            (Laporta/Florentino) a la derecha, asomando por arriba del modal. */}
        <div className="mb-3 flex items-end justify-between gap-2">
          <div className="min-w-0 pb-1">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-[#ffd252]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ffd252] ring-1 ring-[#ffd252]/30">
              {isPremier ? "Compensación" : "Fichajes"}
            </span>
            <h3
              id="pack-drop-title"
              className="mt-2 text-base font-bold tracking-tight sm:text-xl"
            >
              {title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-5 text-zinc-300 sm:text-sm">
              {subtitle}
            </p>
          </div>
          <Image
            src={isPremier ? "/laporta.webp" : "/florentino.webp"}
            alt=""
            width={171}
            height={128}
            className="-mb-1 -mt-16 h-28 w-auto shrink-0 object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.35)] sm:-mt-20 sm:h-32"
            priority
          />
        </div>

        <div className="space-y-2">
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
  );
}
