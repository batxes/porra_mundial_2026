"use client";

import { Card, SectionHeading } from "@/components/common";

const blocks = [
  {
    title: "Que rellenas",
    items: ["Grupos: orden 1 a 4", "Eliminatorias: ocho mejores terceros y ganadores", "Marcadores exactos", "Extras: goleador, MVP y equipos destacados", "Tu once ideal: 11 jugadores con formacion editable"],
  },
  {
    title: "Como puntua",
    items: ["Marcador exacto: suma los goles del partido", "Gol de tu once: +2", "Penalti marcado: +1", "MVP del partido: +3", "Penalti parado: +2", "Penalti fallado: -1", "Roja: -2"],
  },
  {
    title: "Que pasa al final",
    items: ["Posicion acertada en grupo cerrado: +1", "Equipo que avanza en eliminatoria: +1", "Campeon del Mundial: +5", "MVP del Mundial: +5", "Maximo goleador: +5"],
  },
];

export function HowItWorksView() {
  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Reglas claras"
        title="Como funciona TRILIPORRA"
        description="Rellena tu porra antes del inicio. Los puntos se recalculan cada vez que el admin valida o corrige los datos oficiales."
      />

      <div className="grid gap-6 xl:grid-cols-3">
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

      <Card className="space-y-4">
        <h3 className="text-xl font-semibold text-white">Flujo recomendado con datos externos</h3>
        <ol className="space-y-3 text-sm text-slate-300">
          <li>1. El importador trae resultados, goleadores y tarjetas desde la API.</li>
          <li>2. El admin revisa el partido y decide si lo publica como validado.</li>
          <li>3. Al validar, el motor recalcula puntos y se actualiza la clasificacion.</li>
          <li>4. Si una fuente corrige un dato, el admin puede republicarlo y recalcular.</li>
        </ol>
      </Card>
    </div>
  );
}
