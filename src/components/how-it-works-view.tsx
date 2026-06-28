"use client";

import {
  Card,
  ClockIcon,
  ResultsOpenBanner,
  SectionHeading,
} from "@/components/common";

const playSteps = [
  {
    title: "Rellena tu porra",
    description:
      "Tus elecciones, tu once y la fase de grupos se cierran cuando empieza el Mundial.",
  },
  {
    title: "Pronostica cada partido",
    description:
      "Los marcadores se pueden meter o cambiar hasta justo antes de cada partido.",
  },
  {
    title: "Suma puntos y compite",
    description:
      "Con cada partido validado se recalculan los puntos y la clasificación se actualiza.",
  },
];

type RulesSection = {
  step: string;
  title: string;
  lock: string;
  description: string;
  rules: Array<[string, string]>;
  highlight?: string;
  note?: string;
};

const sections: RulesSection[] = [
  {
    step: "1",
    title: "Tus elecciones",
    lock: "Hasta que empiece el Mundial",
    description:
      "Acierta el campeón, los equipos destacados, el máximo goleador y el MVP del torneo.",
    rules: [
      ["Ganador del Mundial", "+25"],
      ["Máximo goleador", "+20"],
      ["MVP del torneo (Sofascore)", "+20"],
      ["Equipo más goleador", "+10"],
      ["Equipo más goleado (mayor diferencia en contra)", "+10"],
      ["Equipo con más rojas", "+10"],
    ],
    highlight: "Ganador del Mundial",
  },
  {
    step: "2",
    title: "Tu once",
    lock: "Hasta que empiece el Mundial",
    description:
      "Elige a tus 11 con formación libre. Suman con sus goles, penaltis y MVPs en todos sus partidos del Mundial, y restan con sus fallos.",
    rules: [
      ["Gol de portero", "+35"],
      ["Gol de defensa", "+11"],
      ["Gol de centrocampista", "+6"],
      ["Gol de delantero", "+2"],
      ["MVP del partido", "+3"],
      ["Penalti parado", "+2"],
      ["Penalti marcado", "+1"],
      ["Penalti fallado", "-1"],
      ["Tarjeta roja", "-2"],
    ],
    highlight: "Gol de portero",
  },
  {
    step: "3",
    title: "Fase de grupos",
    lock: "Hasta que empiece el Mundial",
    description:
      "Ordena cada grupo del 1 al 4 y marca los 8 mejores terceros. Esta fase no aparece en perfil ni clasificación hasta el recuento al cierre de todos los grupos.",
    rules: [
      ["Clasificado como 1º o 2º, pero con el orden cambiado", "+2"],
      ["Ese clasificado en su puesto exacto (1º o 2º)", "+3"],
      ["Mejor tercero que pasa y lo marcaste", "+1"],
    ],
    highlight: "Ese clasificado en su puesto exacto (1º o 2º)",
    note: "Acertar el 3º o 4º puesto exacto no suma por orden: el tercero solo suma si está entre los mejores terceros clasificados.",
  },
  {
    step: "4",
    title: "Resultados",
    lock: "Cada partido, hasta su inicio",
    description:
      "Pronostica el marcador de cada partido. Puedes volver y cambiarlo hasta justo antes de que empiece.",
    rules: [
      ["Aciertas quién gana o el empate", "+1"],
      ["Clavas el resultado exacto", "+goles del partido"],
    ],
    highlight: "Clavas el resultado exacto",
    note: "El resultado se valida con el marcador tras 120 minutos como máximo: 90 minutos más prórroga. La tanda de penaltis no cuenta. El resultado exacto suma además tantos puntos como goles tenga el partido: un 3-2 clavado son 5 puntos extra.",
  },
  {
    step: "5",
    title: "Chips de entrenador",
    lock: "Cada partido, hasta su inicio",
    description:
      "En playoffs eliges un entrenador y un chip por partido. Si ese chip se cumple para el equipo elegido, sumas sus puntos.",
    rules: [
      ["Goleador: tu equipo marca 3 o más goles", "+2"],
      ["Muro: tu equipo deja la portería a cero", "+2"],
      ["Abrelatas: tu equipo marca el primer gol", "+2"],
      [
        "Estratega: gol de falta o córner, directo o con asistencia del lanzador; no cuenta penalti",
        "+2",
      ],
      ["Carnicero: roja para tu equipo", "+5"],
      ["VAR: te hacen penalti", "+3"],
    ],
    highlight: "Carnicero: roja para tu equipo",
    note: "Todos los chips se validan solo hasta los 120 minutos. Nada de lo que ocurra en la tanda de penaltis suma para chips ni resultado.",
  },
];

export function HowItWorksView() {
  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Reglas claras"
        title="Cómo funciona TRILIPORRA"
        description="Tres pasos: rellena tu porra antes del Mundial, pronostica cada partido hasta su inicio y suma puntos con cada acierto."
      />

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight text-white">
          Cómo se juega
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {playSteps.map((step, index) => (
            <Card key={step.title} className="space-y-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/[0.08] text-sm font-bold text-white">
                {index + 1}
              </span>
              <h3 className="text-base font-bold text-white">{step.title}</h3>
              <p className="text-sm leading-5 text-zinc-400">
                {step.description}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight text-white">
          Fases y puntuación
        </h2>
        <ResultsOpenBanner />
        <div className="grid gap-3 md:grid-cols-2">
          {sections.map((section) => (
            <Card key={section.title} className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/[0.08] text-sm font-bold text-white">
                  {section.step}
                </span>
                <h3 className="min-w-0 flex-1 text-lg font-bold text-white">
                  {section.title}
                </h3>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-xs font-bold text-zinc-300">
                  <ClockIcon className="h-3.5 w-3.5 text-[#a7f600]" />
                  {section.lock}
                </span>
              </div>

              <p className="text-sm leading-5 text-zinc-400">
                {section.description}
              </p>

              <div className="space-y-2">
                {section.rules.map(([label, points]) => {
                  const highlighted = label === section.highlight;

                  return (
                    <div
                      key={`${section.title}-${label}`}
                      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
                        highlighted
                          ? "border border-[#a7f600]/30 bg-[#a7f600]/10"
                          : "bg-white/[0.04]"
                      }`}
                    >
                      <span
                        className={`min-w-0 text-sm font-medium ${
                          highlighted ? "text-white" : "text-zinc-300"
                        }`}
                      >
                        {label}
                      </span>
                      <ScoreValue value={points} />
                    </div>
                  );
                })}
              </div>

              {section.note ? (
                <p className="text-xs leading-5 text-zinc-500">
                  {section.note}
                </p>
              ) : null}
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
      className={`shrink-0 text-right text-sm font-bold ${
        negative ? "text-rose-400" : "text-[#a7f600]"
      }`}
    >
      {value}
    </span>
  );
}
