"use client";

import Image from "next/image";

import { PrimaryLink, SectionHeading, Card } from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { data } from "@/lib/data";
import { scoringRules } from "@/lib/scoring";

export function HomeView() {
  const { completion, leaderboard } = useAppContext();
  const participantCount = leaderboard.length;

  return (
    <div className="space-y-10">
      <section className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
        <Card className="overflow-hidden p-0">
          <div className="relative min-h-[420px]">
            <Image
              src="/triliporra-banner.png"
              alt="TRILIPORRA, banner del Mundial 2026"
              fill
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-transparent" />
            <div className="relative z-10 flex h-full flex-col justify-end gap-5 p-8 sm:p-10">
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80">Canadá · México · Estados Unidos</p>
              <h1 className="max-w-2xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
                Tu Mundial empieza antes del primer silbato.
              </h1>
              <p className="max-w-xl text-sm text-slate-200 sm:text-base">
                Completa grupos, cuadro, marcadores, extras y tu once ideal. La puntuación se recalcula cada vez que se valida un partido.
              </p>
              <div className="flex flex-wrap gap-3">
                <PrimaryLink href="/porra">{completion ? "Seguir mi porra" : "Empezar ahora"}</PrimaryLink>
                <a
                  href="/como-funciona"
                  className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Cómo funciona
                </a>
                <a
                  href="/clasificacion"
                  className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Ver clasificación
                </a>
              </div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between gap-6">
          <SectionHeading
            eyebrow="Tu porra"
            title={`${completion}% completada`}
            description="El editor se guarda como borrador y puede hacerse definitivo cuando quieras."
          />
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>Progreso actual</span>
              <strong className="text-white">{completion}%</strong>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-400" style={{ width: `${completion}%` }} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Selecciones" value="48" hint="12 grupos" />
            <StatCard label="Partidos" value="104" hint="11 jun. · 19 jul." />
            <StatCard label="Participantes" value={String(participantCount)} hint="en la porra" />
            <StatCard label="Formato" value="11 + extras" hint="once ideal + premios" />
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card className="space-y-4">
          <SectionHeading
            eyebrow="Ventajas"
            title="Refactorizada para crecer"
            description="Ahora la app está preparada para trabajar con Supabase, rutas reales en Next y datos externos desde servidor."
          />
          <ul className="space-y-3 text-sm text-slate-300">
            <li>• App Router con páginas reales y estado compartido.</li>
            <li>• Tailwind para rehacer el diseño sin CSS monolítico.</li>
            <li>• Motor de scoring aislado y testeable.</li>
            <li>• Preparada para conectar con `API-Football` desde rutas server-side.</li>
          </ul>
        </Card>

        <Card className="space-y-5">
          <SectionHeading
            eyebrow="Sistema de puntos"
            title={data.tournament.name}
            description="Las reglas activas salen del motor de puntuación, así que la UI y los tests leen la misma fuente."
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Object.values(scoringRules).map((rule) => (
              <div key={rule.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-slate-300">{rule.label}</p>
                <p className="mt-2 text-lg font-semibold text-white">{rule.category}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{hint}</p>
    </div>
  );
}
