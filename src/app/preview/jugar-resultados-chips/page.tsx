import { notFound } from "next/navigation";

import { Notice, SectionHeading } from "@/components/common";
import { JugarPlayoffResultsPreview } from "@/components/jugar-playoff-results-preview";

const previewSections = [
  { done: 8, label: "Tus elecciones", step: "1", status: "complete", total: 8 },
  {
    done: 4,
    label: "Playoffs",
    step: "2",
    status: "pending",
    total: 32,
  },
  { done: 11, label: "Tu once", step: "3", status: "complete", total: 11 },
  {
    done: 20,
    label: "Fase de grupos",
    step: "4",
    status: "complete",
    total: 20,
  },
  {
    done: 72,
    label: "Resultados grupos",
    step: "5",
    status: "complete",
    total: 72,
  },
] as const;

function PreviewStepTabs() {
  return (
    <div className="sticky top-0 z-30 -mx-4 overflow-x-auto border-b border-white/10 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 md:mx-0 md:overflow-visible md:px-0">
      <div className="flex w-max max-w-none gap-1 rounded-xl border border-white/10 bg-white/[0.045] p-1 md:grid md:w-full md:grid-cols-5">
        {previewSections.map((tab) => {
          const active = tab.label === "Playoffs";
          const complete = tab.status === "complete";

          return (
            <button
              key={tab.label}
              type="button"
              className={`relative flex h-12 min-w-[9.25rem] items-center justify-center gap-2 rounded-lg px-2 text-xs font-bold transition sm:h-14 sm:text-sm md:min-w-0 ${
                active
                  ? "bg-white text-black shadow-[0_0_0_1px_rgba(255,255,255,0.22)]"
                  : complete
                    ? "bg-[#a7f600]/10 text-zinc-100"
                    : "bg-white/[0.035] text-zinc-300"
              }`}
            >
              <span
                className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] ${
                  active
                    ? "bg-black text-white"
                    : complete
                      ? "bg-[#a7f600]/18 text-[#a7f600]"
                      : "bg-white/10 text-zinc-400"
                }`}
              >
                {tab.step}
              </span>
              <span className="min-w-0 truncate">{tab.label}</span>
              <span
                aria-label={complete ? "Completa" : `${tab.done}/${tab.total}`}
                title={complete ? "Completa" : `${tab.done}/${tab.total}`}
                className={`inline-flex h-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                  complete
                    ? active
                      ? "bg-[#a7f600] text-black"
                      : "bg-[#a7f600]/14 text-[#a7f600]"
                    : active
                      ? "bg-yellow-300 text-black"
                      : "bg-yellow-300/18 text-yellow-200"
                }`}
              >
                {complete ? (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    className="h-3 w-3"
                    fill="none"
                  >
                    <path
                      d="M3.4 8.2 6.5 11.1 12.8 4.8"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.4"
                    />
                  </svg>
                ) : (
                  `${tab.done}/${tab.total}`
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function JugarResultadosChipsPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="pb-44 sm:pb-32">
        <SectionHeading
          eyebrow="Porra"
          title="Juega el Mundial"
          description="Preview local de Resultados playoffs con la nueva modalidad."
        />

        <div className="space-y-4">
          <Notice tone="warm">
            Puedes rellenar cada apartado hasta el momento en el que comienza la
            fase.
          </Notice>
          <PreviewStepTabs />

          <section className="min-h-[520px] space-y-8">
            <div className="space-y-2 pt-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-white">
                    Playoffs
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                    Por jugar se mantiene el battle con cartas de entrenador. Al
                    cerrarse el partido, pasa al resumen compacto con resultado,
                    puntos y chip.
                  </p>
                </div>
                <span className="text-sm font-semibold text-zinc-500">
                  4/32
                </span>
              </div>
            </div>

            <section className="border-t border-white/10 pt-5">
              <JugarPlayoffResultsPreview />
            </section>
          </section>
        </div>
      </div>
    </main>
  );
}
