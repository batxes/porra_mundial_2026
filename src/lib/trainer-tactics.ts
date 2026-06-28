export const trainerTactics = [
  {
    id: "over-25",
    title: "Goleador",
    points: 3,
  },
  {
    id: "clean-sheet",
    title: "Muro",
    points: 2,
  },
  {
    id: "first-goal",
    title: "Abrelatas",
    points: 1,
  },
  {
    id: "set-piece",
    title: "Estratega",
    points: 3,
  },
  {
    id: "red-card",
    title: "Carnicero",
    points: 5,
  },
  {
    id: "penalty",
    title: "Remontada",
    points: 6,
  },
] as const;

export type TrainerTacticId = (typeof trainerTactics)[number]["id"];
export type TrainerTactic = (typeof trainerTactics)[number];

export const trainerTacticById: ReadonlyMap<string, TrainerTactic> = new Map(
  trainerTactics.map((tactic) => [tactic.id, tactic]),
);
