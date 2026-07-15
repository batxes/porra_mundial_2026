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

// Doce duelos cerrados. Las cifras geográficas usan el censo de 2022 o
// distancias en línea recta para que la regla sea reproducible. Sin empates.
const DEMO_DUELS: QuienDaMasDuel[] = [
  {
    id: "altura-courtois-haaland",
    question: "¿Quién mide más?",
    metricLabel: "de altura",
    format: "height",
    a: side(P.courtois, 199),
    b: side(P.haaland, 195),
  },
  {
    id: "paises-clubes-haaland-courtois",
    question: "¿Quién ha jugado en más países a nivel de clubes?",
    metricLabel: "países distintos",
    a: side(P.haaland, 4),
    b: side(P.courtois, 3),
  },
  {
    id: "traspasos-dembele-ferran",
    question: "¿Quién ha movido más dinero en traspasos?",
    metricLabel: "traspasos acumulados",
    format: "currency",
    a: side(P.dembele, 220_000_000),
    b: side(P.ferran, 88_500_000),
  },
  {
    id: "letras-cristiano-messi",
    question: "¿Quién tiene más letras en su nombre completo?",
    metricLabel: "letras sin espacios",
    a: side(P.cristiano, 31),
    b: side(P.messi, 27),
  },
  {
    id: "poblacion-vinicius-neymar",
    question: "¿Quién nació en una ciudad con más habitantes?",
    metricLabel: "habitantes · censo 2022",
    format: "compact",
    a: side(P.vinicius, 896_744),
    b: side(P.neymar, 449_955),
  },
  {
    id: "distancia-capital-haaland-messi",
    question: "¿Quién nació a más kilómetros de la capital de su selección?",
    metricLabel: "km en línea recta",
    a: side(P.haaland, 1_008),
    b: side(P.messi, 281),
  },
  {
    id: "hermanos-messi-mbappe",
    question: "¿Quién tiene más hermanos?",
    metricLabel: "hermanos",
    a: side(P.messi, 3),
    b: side(P.mbappe, 2),
  },
  {
    id: "primer-mundial-mbappe-messi",
    question: "¿Quién marcó más goles en su primer Mundial?",
    metricLabel: "goles en su debut mundialista",
    a: side(P.mbappe, 4),
    b: side(P.messi, 1),
  },
  {
    id: "edad-debut-messi-mbappe",
    question: "¿Quién tenía más edad cuando debutó como profesional?",
    metricLabel: "al debutar",
    format: "age",
    a: side(P.messi, 17 + 114 / 365),
    b: side(P.mbappe, 16 + 347 / 365),
  },
  {
    id: "ecuador-messi-vinicius",
    question: "¿Quién nació a más kilómetros del ecuador?",
    metricLabel: "km hasta el ecuador",
    a: side(P.messi, 3_665),
    b: side(P.vinicius, 2_538),
  },
  {
    id: "husos-mbappe-messi",
    question: "¿El país de quién tiene más husos horarios?",
    metricLabel: "husos · contando ultramar",
    a: side(P.mbappe, 12),
    b: side(P.messi, 1),
  },
  {
    id: "finales-mundial-mbappe-messi",
    question: "¿Quién marcó más goles en finales de un Mundial?",
    metricLabel: "goles en finales",
    a: side(P.mbappe, 4),
    b: side(P.messi, 2),
  },
];

const DUELS_PER_GAME = DEMO_DUELS.length;

function pickRandomDuels(count: number): QuienDaMasDuel[] {
  const pool = [...DEMO_DUELS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Baraja tambien el lado en que sale cada crack para que la "a" no gane
  // siempre por costumbre.
  return pool.slice(0, count).map((duel) =>
    Math.random() < 0.5 ? duel : { ...duel, a: duel.b, b: duel.a },
  );
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
