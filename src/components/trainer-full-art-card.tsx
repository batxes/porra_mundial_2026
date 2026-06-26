import type { CSSProperties } from "react";

import Image from "next/image";

import { TeamFlag } from "@/components/common";

type MosaicTone = "primary" | "secondary" | "third" | "light";

type MosaicBlock = {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: MosaicTone;
  opacity?: number;
};

type PixelBust = {
  pattern: string[];
  palette: Record<string, string>;
};

export type TrainerDemoCard = {
  id: string;
  coach: string;
  country: string;
  teamId: string;
  points: number;
  role: string;
  artUrl: string;
  className?: string;
  background: string;
  glow: string;
  edge: string;
  tones: Record<MosaicTone, string>;
  mosaic: MosaicBlock[];
  bust: PixelBust;
};

type TrainerCardStyle = CSSProperties & Record<`--${string}`, string>;

const coachBustPattern = [
  "....................",
  ".......OOOOOO.......",
  ".....OOHHHHHHOO.....",
  "....OHHHHhhHHHHO....",
  "...OHHhSSSSSShHHO...",
  "...OHhSSSSSSSShO....",
  "...OHSSBSSSSBSSO....",
  "...OHSSSESSSESSO....",
  "...OHHSSSSSSSHHO....",
  "....OHSSMMMSSHO.....",
  ".....OSSSSSSSO......",
  ".....OOJJJJOO.......",
  "....OJJJJJJJJO......",
  "...OJJJWTTWJJJO.....",
  "..OJJJJWTTWJJJJO....",
  "..OJJJJJWWJJJJJO....",
  "..OJJJJJJJJJJJJO....",
  ".OJJJJJJJJJJJJJJO...",
  ".OJJJDDDDDDDJJJJO...",
  "..ODDDDDDDDDDDO.....",
  "....................",
];

const squareCoachBustPattern = [
  "....................",
  "......OOOOOOOO......",
  "....OOHHHHHHHHO.....",
  "...OHHHHhhhHHHHO....",
  "...OHHSSSSSSHHHO....",
  "..OHSSSSSSSSSSHO....",
  "..OHSSBSSSSBSSHO....",
  "..OHSSSESSSESSHO....",
  "..OHHSSSSSSSSHHO....",
  "...OHSSSMMSSSHO.....",
  "....OSSSSSSSSO......",
  "....OOJJJJJJOO......",
  "...OJJJJJJJJJJO.....",
  "..OJJJJWTTWJJJJO....",
  ".OJJJJJWTTWJJJJJO...",
  ".OJJJJJJWWJJJJJJO...",
  ".OJJJJJJJJJJJJJJO...",
  "OJJJJJJJJJJJJJJJJO..",
  "OJJJDDDDDDDDDJJJJO..",
  ".OODDDDDDDDDDDOO....",
  "....................",
];

const brazilMosaic: MosaicBlock[] = [
  { x: 4, y: 8, w: 28, h: 12, tone: "secondary", opacity: 0.72 },
  { x: 30, y: 13, w: 36, h: 22, tone: "primary", opacity: 0.58 },
  { x: 59, y: 7, w: 26, h: 14, tone: "light", opacity: 0.8 },
  { x: 12, y: 31, w: 21, h: 17, tone: "third", opacity: 0.54 },
  { x: 66, y: 38, w: 24, h: 20, tone: "secondary", opacity: 0.52 },
  { x: 7, y: 62, w: 30, h: 19, tone: "primary", opacity: 0.44 },
  { x: 51, y: 66, w: 37, h: 15, tone: "third", opacity: 0.36 },
];

const spainMosaic: MosaicBlock[] = [
  { x: 5, y: 7, w: 38, h: 13, tone: "primary", opacity: 0.7 },
  { x: 43, y: 13, w: 43, h: 17, tone: "secondary", opacity: 0.68 },
  { x: 15, y: 31, w: 33, h: 24, tone: "third", opacity: 0.48 },
  { x: 58, y: 35, w: 33, h: 16, tone: "primary", opacity: 0.58 },
  { x: 4, y: 59, w: 27, h: 21, tone: "secondary", opacity: 0.58 },
  { x: 35, y: 68, w: 45, h: 12, tone: "light", opacity: 0.44 },
];

const franceMosaic: MosaicBlock[] = [
  { x: 5, y: 8, w: 30, h: 24, tone: "primary", opacity: 0.68 },
  { x: 34, y: 10, w: 23, h: 29, tone: "light", opacity: 0.5 },
  { x: 58, y: 7, w: 30, h: 25, tone: "secondary", opacity: 0.72 },
  { x: 10, y: 43, w: 27, h: 17, tone: "third", opacity: 0.48 },
  { x: 51, y: 47, w: 36, h: 20, tone: "primary", opacity: 0.42 },
  { x: 20, y: 71, w: 59, h: 10, tone: "secondary", opacity: 0.38 },
];

const skinPalette = {
  O: "#1c1511",
  S: "#d49a6a",
  B: "#4e3930",
  E: "#101013",
  M: "#703126",
  W: "#f6f2e8",
};

export const trainerDemoCards: TrainerDemoCard[] = [
  {
    id: "brasil-ancelotti",
    coach: "Carlo Ancelotti",
    country: "Brasil",
    teamId: "bra",
    points: 97,
    role: "DT",
    artUrl: "/trainer-cards/brasil-ancelotti.png",
    background:
      "radial-gradient(circle at 50% 30%, rgba(22, 58, 188, 0.58), transparent 20%), linear-gradient(135deg, rgba(0, 121, 67, 0.94), rgba(6, 49, 36, 0.96) 48%, rgba(245, 205, 55, 0.74) 49%, rgba(0, 72, 58, 0.95) 64%, rgba(9, 26, 64, 0.98))",
    glow: "rgba(34, 197, 94, 0.42)",
    edge: "#22c55e",
    tones: {
      primary: "#007a42",
      secondary: "#ffd63b",
      third: "#163ab8",
      light: "#eff7d8",
    },
    mosaic: brazilMosaic,
    bust: {
      pattern: coachBustPattern,
      palette: {
        ...skinPalette,
        H: "#c9c3b5",
        h: "#f0eadb",
        J: "#14253c",
        D: "#07111d",
        T: "#ffd63b",
      },
    },
  },
  {
    id: "espana-de-la-fuente",
    coach: "Luis de la Fuente",
    country: "Espa\u00f1a",
    teamId: "esp",
    points: 96,
    role: "DT",
    artUrl: "/trainer-cards/espana-de-la-fuente.png",
    background:
      "radial-gradient(circle at 42% 28%, rgba(255, 205, 58, 0.76), transparent 22%), linear-gradient(135deg, rgba(148, 12, 28, 0.98), rgba(44, 15, 32, 0.96) 44%, rgba(255, 205, 58, 0.78) 45%, rgba(197, 24, 42, 0.96) 62%, rgba(25, 16, 29, 0.99))",
    glow: "rgba(255, 45, 45, 0.4)",
    edge: "#ff2d2d",
    tones: {
      primary: "#c9182a",
      secondary: "#ffcd3a",
      third: "#791321",
      light: "#fff2ba",
    },
    mosaic: spainMosaic,
    bust: {
      pattern: squareCoachBustPattern,
      palette: {
        ...skinPalette,
        H: "#3e3028",
        h: "#7a665b",
        J: "#92182a",
        D: "#350c14",
        T: "#ffcd3a",
      },
    },
  },
  {
    id: "francia-deschamps",
    coach: "Didier Deschamps",
    country: "Francia",
    teamId: "fra",
    points: 95,
    role: "DT",
    artUrl: "/trainer-cards/francia-deschamps.png",
    background:
      "radial-gradient(circle at 46% 29%, rgba(255, 255, 255, 0.44), transparent 19%), linear-gradient(135deg, rgba(24, 57, 152, 0.98), rgba(8, 18, 56, 0.98) 42%, rgba(248, 249, 255, 0.5) 43%, rgba(24, 57, 152, 0.94) 55%, rgba(205, 38, 58, 0.9))",
    glow: "rgba(84, 145, 255, 0.42)",
    edge: "#38bdf8",
    tones: {
      primary: "#183998",
      secondary: "#cd263a",
      third: "#426de0",
      light: "#f8f9ff",
    },
    mosaic: franceMosaic,
    bust: {
      pattern: coachBustPattern,
      palette: {
        ...skinPalette,
        H: "#7e858f",
        h: "#d9dce2",
        J: "#132c72",
        D: "#07143c",
        T: "#cd263a",
      },
    },
  },
];

export function TrainerFullArtCard({ card }: { card: TrainerDemoCard }) {
  return (
    <article
      className={`trainer-full-card theme-dark relative aspect-[5/7] overflow-hidden rounded-lg ${card.className || ""}`}
      style={
        {
          "--trainer-bg": card.background,
          "--trainer-edge": card.edge,
          "--trainer-glow": card.glow,
        } as TrainerCardStyle
      }
    >
      <Image
        src={card.artUrl}
        alt=""
        fill
        priority
        sizes="(max-width: 640px) 88vw, (max-width: 1024px) 42vw, 340px"
        className="trainer-card-art object-cover"
        unoptimized
      />

      <div className="trainer-card-holo" aria-hidden="true" />
      <div className="trainer-card-scan" aria-hidden="true" />

      <div className="trainer-nameplate pointer-events-none absolute inset-x-0 bottom-0 z-30 px-[8%] pb-[7%] pt-[28%]">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-white/24 to-transparent" />
        <p
          className="mt-[4%] truncate font-bold text-white"
          style={{
            fontSize: "8cqw",
            lineHeight: 1.05,
            textShadow: "0 3px 12px rgba(0,0,0,0.9)",
          }}
        >
          {card.coach}
        </p>
        <div
          className="mt-[4%] flex min-w-0 items-center"
          style={{ gap: "2.6cqw" }}
        >
          <span
            className="block shrink-0 overflow-hidden rounded-sm border border-white/24 bg-white/10"
            style={{ height: "7.2cqw", width: "10.6cqw" }}
          >
            <TeamFlag teamId={card.teamId} className="h-full w-full" />
          </span>
          <span
            className="truncate font-bold text-zinc-200"
            style={{ fontSize: "5.6cqw", lineHeight: 1.1 }}
          >
            {card.country}
          </span>
        </div>
      </div>
    </article>
  );
}
