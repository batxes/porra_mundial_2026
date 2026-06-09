"use client";

import { Card, SectionHeading } from "@/components/common";

const blocks = [
  {
    title: "Que rellenas",
    items: ["Tus elecciones: ganador, equipos y jugadores clave", "Tu once ideal: 11 jugadores con formacion editable", "Fase de grupos: orden 1 a 4", "Resultados: marcador de cada partido disponible"],
  },
  {
    title: "Tus elecciones",
    items: ["Ganador del mundial: +25", "Equipo mas goleador: +10", "Equipo mas goleado: +10", "Equipo con mas rojas: +10", "Maximo goleador: +20", "MVP: +20"],
  },
  {
    title: "Fase de grupos",
    items: ["Equipo clasificado acertado: +2", "Orden exacto de grupo: +3"],
  },
  {
    title: "Durante el torneo",
    items: ["Fase de grupos: equipo que pasa +2, orden exacto +3", "Resultados: eleccion acertada +1, exacto suma los goles", "Gol de tu once: DEL +2, MED +6, DEF +11, POR +35", "Penalti marcado: +1", "MVP del partido: +3", "Penalti parado: +2", "Penalti fallado: -1", "Roja: -2"],
  },
];

export function HowItWorksView() {
  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Reglas claras"
        title="Como funciona TRILIPORRA"
        description="Rellena tus pasos antes del inicio del torneo. Los marcadores se pueden editar hasta que empiece cada partido."
      />

      <div className="grid gap-6 xl:grid-cols-4">
        {blocks.map((block) => (
          <Card key={block.title} className="space-y-4">
            <h3 className="text-xl font-semibold text-white">{block.title}</h3>
            <ul className="space-y-2 text-sm text-slate-300">
              {block.items.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
