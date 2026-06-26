import {
  TrainerFullArtCard,
  trainerDemoCards,
} from "@/components/trainer-full-art-card";

export default function EntrenadoresDemoPage() {
  return (
    <section className="theme-dark mx-auto w-full max-w-6xl py-6 sm:py-10">
      <div className="mb-7 flex flex-col gap-3 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-[#a7f600]">
            Demo cartas
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
            Entrenadores full art
          </h1>
          <p className="mt-2 max-w-2xl text-sm font-medium text-zinc-400 sm:text-base">
            {"Brasil, Espa\u00f1a y Francia"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold text-zinc-300">
          {trainerDemoCards.map((card) => (
            <span
              key={card.id}
              className="rounded-md border border-white/10 bg-white/[0.06] px-3 py-2"
            >
              {card.points} PTS
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7">
        {trainerDemoCards.map((card) => (
          <div key={card.id} className="mx-auto w-full max-w-[340px]">
            <TrainerFullArtCard card={card} />
          </div>
        ))}
      </div>
    </section>
  );
}
