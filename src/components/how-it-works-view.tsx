"use client";

import { Card, SectionHeading } from "@/components/common";

const phases = [
  {
    step: "1",
    title: "Tus elecciones",
    description: "Ganador del Mundial, equipos destacados, maximo goleador y MVP.",
    lock: "Hasta que empiece el Mundial",
  },
  {
    step: "2",
    title: "Tu once",
    description: "Elige 11 jugadores con formacion editable.",
    lock: "Hasta que empiece el Mundial",
  },
  {
    step: "3",
    title: "Fase de grupos",
    description: "Ordena cada grupo del 1 al 4 y marca tus terceros favoritos.",
    lock: "Hasta que empiece el Mundial",
  },
  {
    step: "4",
    title: "Resultados",
    description: "Pronostica el marcador de cada partido cuando este disponible.",
    lock: "Hasta que empiece cada partido",
  },
];

const scoringGroups = [
  {
    title: "Tus elecciones",
    rules: [
      ["Ganador del mundial", "+25"],
      ["Equipo mas goleador", "+10"],
      ["Equipo mas goleado", "+10"],
      ["Equipo con mas rojas", "+10"],
      ["Maximo goleador", "+20"],
      ["MVP", "+20"],
    ],
  },
  {
    title: "Fase de grupos",
    rules: [
      ["Equipo clasificado acertado", "+2"],
      ["Tercer clasificado acertado", "+1"],
      ["Orden exacto de grupo", "+3"],
    ],
  },
  {
    title: "Resultados",
    rules: [
      ["Eleccion acertada", "+1"],
      ["Resultado exacto", "goles del partido"],
    ],
  },
  {
    title: "Tu once",
    rules: [
      ["Gol delantero", "+2"],
      ["Gol centrocampista", "+6"],
      ["Gol defensa", "+11"],
      ["Gol portero", "+35"],
      ["Penalti marcado", "+1"],
      ["MVP del partido", "+3"],
      ["Penalti parado", "+2"],
      ["Penalti fallado", "-1"],
      ["Roja", "-2"],
    ],
  },
];

export function HowItWorksView() {
  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Reglas claras"
        title="Como funciona TRILIPORRA"
        description="Completa tus elecciones antes del Mundial. Los resultados se pueden cambiar partido a partido hasta el pitido inicial."
      />

      <section className="space-y-3">
        <h2 className="text-2xl font-black tracking-tight text-white">Fases</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {phases.map((phase) => (
            <Card key={phase.title} className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#a7f600] text-sm font-black text-black">
                {phase.step}
              </span>
              <div className="min-w-0 space-y-2">
                <h3 className="text-lg font-bold text-white">{phase.title}</h3>
                <p className="text-sm leading-5 text-zinc-400">{phase.description}</p>
                <span className="inline-flex rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-xs font-black text-zinc-200">
                  {phase.lock}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-black tracking-tight text-white">Puntuacion</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {scoringGroups.map((group) => (
            <Card key={group.title} className="space-y-4">
              <h3 className="text-lg font-bold text-white">{group.title}</h3>
              <div className="space-y-2">
                {group.rules.map(([label, points]) => (
                  <div key={`${group.title}-${label}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2">
                    <span className="min-w-0 text-sm font-medium text-zinc-300">{label}</span>
                    <ScoreValue value={points} />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function ScoreValue({ value }: { value: string }) {
  const negative = value.startsWith("-");

  return (
    <span
      className={`shrink-0 text-right text-sm font-black ${
        negative ? "text-rose-400" : "text-[#a7f600]"
      }`}
    >
      {value}
    </span>
  );
}
