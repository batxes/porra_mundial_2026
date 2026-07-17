"use client";

import { useMemo, useState } from "react";

import {
  QuienDaMasModal,
  type QuienDaMasConfig,
  type QuienDaMasDuel,
  type QuienDaMasResult,
  type QuienDaMasSide,
} from "@/components/quien-da-mas-modal";

type BankPlayer = Omit<QuienDaMasSide, "value">;

// Cracks del banco de duelos. Las ilustraciones nuevas mantienen el pixel art
// del juego, pero representan a los futbolistas como personas.
const P = {
  messi: { id: "messi", name: "Messi", teamCode: "ar", teamName: "Argentina", image: "/messi.webp" },
  mbappe: { id: "mbappe", name: "Mbappé", teamCode: "fr", teamName: "Francia", image: "/mbappe.webp" },
  haaland: { id: "haaland", name: "Haaland", teamCode: "no", teamName: "Noruega", image: "/halland.webp" },
  courtois: { id: "courtois", name: "Courtois", teamCode: "be", teamName: "Bélgica", image: "/courtois.webp" },
  dembele: { id: "dembele", name: "Dembélé", teamCode: "fr", teamName: "Francia", image: "/dembele.webp" },
  ferran: { id: "ferran", name: "Ferran", teamCode: "es", teamName: "España", image: "/ferran.webp" },
  julian: { id: "julian", name: "Julián Álvarez", teamCode: "ar", teamName: "Argentina", image: "/julian.webp" },
  valverde: { id: "valverde", name: "Valverde", teamCode: "uy", teamName: "Uruguay", image: "/valverde.webp" },
  cristiano: { id: "cristiano", name: "Cristiano", teamCode: "pt", teamName: "Portugal", image: "/cristiano.webp" },
  neymar: { id: "neymar", name: "Neymar", teamCode: "br", teamName: "Brasil", image: "/neymar.webp" },
  vinicius: { id: "vinicius", name: "Vinícius", teamCode: "br", teamName: "Brasil", image: "/vinicius.webp" },
  bellingham: { id: "bellingham", name: "Bellingham", teamCode: "gb", teamName: "Inglaterra" },
  yamal: { id: "yamal", name: "Lamine Yamal", teamCode: "es", teamName: "España" },
  pedri: { id: "pedri", name: "Pedri", teamCode: "es", teamName: "España" },
  modric: { id: "modric", name: "Modrić", teamCode: "hr", teamName: "Croacia" },
  ramos: { id: "ramos", name: "Sergio Ramos", teamCode: "es", teamName: "España" },
  klose: { id: "klose", name: "Klose", teamCode: "de", teamName: "Alemania" },
  ronaldo9: { id: "ronaldo9", name: "Ronaldo Nazário", teamCode: "br", teamName: "Brasil" },
  pele: { id: "pele", name: "Pelé", teamCode: "br", teamName: "Brasil" },
  maradona: { id: "maradona", name: "Maradona", teamCode: "ar", teamName: "Argentina" },
  fontaine: { id: "fontaine", name: "Just Fontaine", teamCode: "fr", teamName: "Francia" },
} satisfies Record<string, BankPlayer>;

function side(player: BankPlayer, value: number): QuienDaMasSide {
  return { ...player, value };
}

// Edición del día: doce duelos cerrados, con seis respuestas a cada lado.
// Los cortes históricos hacen que las cifras no cambien durante el Mundial.
const DEMO_DUELS: QuienDaMasDuel[] = [
  {
    id: "edad-messi-cristiano-2024",
    question: "¿Quién era mayor el 31 de diciembre de 2024?",
    metricLabel: "a esa fecha",
    format: "age",
    a: side(P.messi, 37 + 190 / 365),
    b: side(P.cristiano, 39 + 330 / 365),
  },
  {
    id: "primer-mundial-messi-neymar",
    question: "¿Quién marcó más goles en su primer Mundial?",
    metricLabel: "goles en su debut mundialista",
    a: side(P.messi, 1),
    b: side(P.neymar, 4),
  },
  {
    id: "balones-oro-messi-cristiano-2024",
    question: "¿Quién tenía más Balones de Oro al acabar 2024?",
    metricLabel: "Balones de Oro",
    a: side(P.messi, 8),
    b: side(P.cristiano, 5),
  },
  {
    id: "champions-vinicius-neymar-2024",
    question: "¿Quién había ganado más Champions a junio de 2024?",
    metricLabel: "Champions League",
    a: side(P.vinicius, 2),
    b: side(P.neymar, 1),
  },
  {
    id: "finales-champions-messi-cristiano",
    question: "¿Quién marcó más goles en finales de Champions?",
    metricLabel: "goles en finales",
    a: side(P.messi, 2),
    b: side(P.cristiano, 4),
  },
  {
    id: "goles-mundial-2014-cristiano-neymar",
    question: "¿Quién marcó más goles en el Mundial de Brasil 2014?",
    metricLabel: "goles en Brasil 2014",
    a: side(P.cristiano, 1),
    b: side(P.neymar, 4),
  },
  {
    id: "mundiales-francia-brasil-2022",
    question: "¿La selección de quién tenía más Mundiales al acabar 2022?",
    metricLabel: "Copas del Mundo",
    a: side(P.mbappe, 2),
    b: side(P.neymar, 5),
  },
  {
    id: "poblacion-brasil-portugal-2022",
    question: "¿La selección de quién tenía más habitantes en 2022?",
    metricLabel: "habitantes del país",
    format: "compact",
    a: side(P.neymar, 203_062_512),
    b: side(P.cristiano, 10_467_366),
  },
  {
    id: "superficie-noruega-belgica",
    question: "¿El país de quién tiene más superficie?",
    metricLabel: "km² de superficie",
    format: "compact",
    a: side(P.haaland, 385_207),
    b: side(P.courtois, 30_689),
  },
  {
    id: "ecuador-mbappe-vinicius",
    question: "¿Quién nació más lejos del ecuador?",
    metricLabel: "km hasta el ecuador",
    a: side(P.mbappe, 5_437),
    b: side(P.vinicius, 2_538),
  },
  {
    id: "cantera-messi-mbappe",
    question: "¿Quién pasó por una cantera fundada hace más tiempo?",
    metricLabel: "años de historia en 2024",
    a: side(P.messi, 121),
    b: side(P.mbappe, 46),
  },
  {
    id: "nacimiento-messi-haaland",
    question: "¿Quién nació más recientemente?",
    metricLabel: "año de nacimiento",
    a: side(P.messi, 1987),
    b: side(P.haaland, 2000),
  },
];

const DUELS_PER_GAME = DEMO_DUELS.length;

function pickRandomDuels(count: number): QuienDaMasDuel[] {
  const pool = [...DEMO_DUELS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Solo se baraja el orden: la edición ya alterna seis respuestas por lado.
  return pool.slice(0, count);
}

export default function QuienDaMasDemoPage() {
  const [open, setOpen] = useState(true);
  const [session, setSession] = useState(0);
  const [lastResult, setLastResult] = useState<QuienDaMasResult | null>(null);

  const config = useMemo<QuienDaMasConfig>(
    () => ({
      id: `demo-quiendamas-${session}`,
      title: "¿QUIÉN DA MÁS?",
      duelTimeMs: 10000,
      duels: pickRandomDuels(DUELS_PER_GAME),
      rewards: [
        {
          minScore: 3,
          pool: "medios",
          image: "/sobre-medios.webp",
          title: "Sobre Medios",
        },
        {
          minScore: 6,
          pool: "delanteros",
          image: "/sobre-delanteros.webp",
          title: "Sobre Delanteros",
        },
        {
          minScore: 9,
          pool: "defensas",
          image: "/sobre-defensas.webp",
          title: "Sobre Defensas",
        },
        {
          minScore: 12,
          pool: "stars",
          image: "/sobre-estrellas.webp",
          title: "Sobre Estrellas",
        },
      ],
    }),
    [session],
  );

  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      {open ? (
        <QuienDaMasModal
          key={config.id}
          config={config}
          onClose={() => setOpen(false)}
          onCompleted={(result) => setLastResult(result)}
          onOpenPacks={() => setOpen(false)}
          onReplay={() => setSession((value) => value + 1)}
        />
      ) : (
        <div className="theme-dark w-full rounded-2xl border border-white/10 bg-[#151515] p-6 text-white shadow-2xl shadow-black/50">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#a7f600]">
            Demo / ¿Quién da más?
          </p>
          {lastResult ? (
            <p className="mt-3 text-sm text-zinc-300">
              Has acertado{" "}
              <span className="font-bold text-white">
                {lastResult.correct}/{lastResult.total}
              </span>{" "}
              {"->"}{" "}
              <span className="font-bold text-[#a7f600]">
                {lastResult.packs} {lastResult.packs === 1 ? "sobre" : "sobres"}
              </span>
            </p>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">Demo cerrada.</p>
          )}
          <button
            type="button"
            onClick={() => {
              setSession((value) => value + 1);
              setOpen(true);
            }}
            className="mt-5 w-full rounded-lg bg-[#a7f600] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black transition hover:bg-[#c7ff43]"
          >
            Jugar otra vez
          </button>
        </div>
      )}
    </div>
  );
}
