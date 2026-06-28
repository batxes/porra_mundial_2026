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

type TrainerDemoCardInput = {
  id: string;
  coach: string;
  country: string;
  teamId: string;
  points: number;
  artUrl: string;
  primary: string;
  secondary: string;
  third: string;
  light?: string;
  hair?: string;
  jacket?: string;
};

function createTrainerDemoCard({
  id,
  coach,
  country,
  teamId,
  points,
  artUrl,
  primary,
  secondary,
  third,
  light = "#f8fafc",
  hair = "#3e3028",
  jacket,
}: TrainerDemoCardInput): TrainerDemoCard {
  const edge = secondary;

  return {
    id,
    coach,
    country,
    teamId,
    points,
    role: "DT",
    artUrl,
    background: `radial-gradient(circle at 46% 28%, ${light}66, transparent 20%), linear-gradient(135deg, ${primary}, #080b13 46%, ${secondary}cc 47%, ${third} 64%, #05070d)`,
    glow: `${secondary}66`,
    edge,
    tones: {
      primary,
      secondary,
      third,
      light,
    },
    mosaic: brazilMosaic,
    bust: {
      pattern: coachBustPattern,
      palette: {
        ...skinPalette,
        H: hair,
        h: light,
        J: jacket || primary,
        D: "#090b13",
        T: secondary,
      },
    },
  };
}

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
  createTrainerDemoCard({
    id: "mexico-aguirre",
    coach: "Javier Aguirre",
    country: "M\u00e9xico",
    teamId: "mex",
    points: 94,
    artUrl: "/trainer-cards/mexico-aguirre.png",
    primary: "#006847",
    secondary: "#ce1126",
    third: "#073b2b",
    light: "#f7f7f7",
  }),
  createTrainerDemoCard({
    id: "sudafrica-broos",
    coach: "Hugo Broos",
    country: "Sud\u00e1frica",
    teamId: "rsa",
    points: 83,
    artUrl: "/trainer-cards/sudafrica-broos.png",
    primary: "#007a4d",
    secondary: "#ffb612",
    third: "#002395",
    light: "#f8fafc",
  }),
  createTrainerDemoCard({
    id: "suiza-yakin",
    coach: "Murat Yakin",
    country: "Suiza",
    teamId: "sui",
    points: 90,
    artUrl: "/trainer-cards/suiza-yakin.png",
    primary: "#da291c",
    secondary: "#ffffff",
    third: "#70130f",
    light: "#fff5f5",
  }),
  createTrainerDemoCard({
    id: "canada-marsch",
    coach: "Jesse Marsch",
    country: "Canad\u00e1",
    teamId: "can",
    points: 87,
    artUrl: "/trainer-cards/canada-marsch.png",
    primary: "#d80621",
    secondary: "#ffffff",
    third: "#4b0b13",
    light: "#fff1f2",
  }),
  createTrainerDemoCard({
    id: "marruecos-ouahbi",
    coach: "Mohamed Ouahbi",
    country: "Marruecos",
    teamId: "mar",
    points: 88,
    artUrl: "/trainer-cards/marruecos-ouahbi.png",
    primary: "#c1272d",
    secondary: "#006233",
    third: "#5f1217",
    light: "#f6fff8",
  }),
  createTrainerDemoCard({
    id: "estados-unidos-pochettino",
    coach: "Mauricio Pochettino",
    country: "Estados Unidos",
    teamId: "usa",
    points: 89,
    artUrl: "/trainer-cards/estados-unidos-pochettino.png",
    primary: "#1d3f8f",
    secondary: "#b31942",
    third: "#071b4f",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "australia-popovic",
    coach: "Tony Popovic",
    country: "Australia",
    teamId: "aus",
    points: 85,
    artUrl: "/trainer-cards/australia-popovic.png",
    primary: "#00843d",
    secondary: "#ffcd00",
    third: "#052f21",
    light: "#f8fafc",
  }),
  createTrainerDemoCard({
    id: "alemania-nagelsmann",
    coach: "Julian Nagelsmann",
    country: "Alemania",
    teamId: "ger",
    points: 94,
    artUrl: "/trainer-cards/alemania-nagelsmann.png",
    primary: "#111827",
    secondary: "#ffce00",
    third: "#dd0000",
    light: "#f8fafc",
  }),
  createTrainerDemoCard({
    id: "costa-de-marfil-fae",
    coach: "Emerse Fa\u00e9",
    country: "Costa de Marfil",
    teamId: "civ",
    points: 84,
    artUrl: "/trainer-cards/costa-de-marfil-fae.png",
    primary: "#f77f00",
    secondary: "#009e60",
    third: "#623412",
    light: "#fff7ed",
  }),
  createTrainerDemoCard({
    id: "paises-bajos-koeman",
    coach: "Ronald Koeman",
    country: "Pa\u00edses Bajos",
    teamId: "ned",
    points: 93,
    artUrl: "/trainer-cards/paises-bajos-koeman.png",
    primary: "#ff5a00",
    secondary: "#21468b",
    third: "#6a2500",
    light: "#fff7ed",
  }),
  createTrainerDemoCard({
    id: "japon-moriyasu",
    coach: "Hajime Moriyasu",
    country: "Jap\u00f3n",
    teamId: "jpn",
    points: 87,
    artUrl: "/trainer-cards/japon-moriyasu.png",
    primary: "#1f4ea8",
    secondary: "#bc002d",
    third: "#061a44",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "belgica-garcia",
    coach: "Rudi Garcia",
    country: "B\u00e9lgica",
    teamId: "bel",
    points: 91,
    artUrl: "/trainer-cards/belgica-garcia.png",
    primary: "#111111",
    secondary: "#fae042",
    third: "#ed2939",
    light: "#fff7cc",
  }),
  createTrainerDemoCard({
    id: "egipto-hassan",
    coach: "Hossam Hassan",
    country: "Egipto",
    teamId: "egy",
    points: 85,
    artUrl: "/trainer-cards/egipto-hassan.png",
    primary: "#ce1126",
    secondary: "#ffffff",
    third: "#111111",
    light: "#f8fafc",
  }),
  createTrainerDemoCard({
    id: "cabo-verde-bubista",
    coach: "Bubista",
    country: "Cabo Verde",
    teamId: "cpv",
    points: 82,
    artUrl: "/trainer-cards/cabo-verde-bubista.png",
    primary: "#003893",
    secondary: "#cf2027",
    third: "#f7d116",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "noruega-solbakken",
    coach: "St\u00e5le Solbakken",
    country: "Noruega",
    teamId: "nor",
    points: 86,
    artUrl: "/trainer-cards/noruega-solbakken.png",
    primary: "#ba0c2f",
    secondary: "#00205b",
    third: "#50101d",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "bosnia-barbarez",
    coach: "Sergej Barbarez",
    country: "Bosnia y Herzegovina",
    teamId: "bih",
    points: 81,
    artUrl: "/trainer-cards/bosnia-barbarez.png",
    primary: "#002f6c",
    secondary: "#f7d116",
    third: "#061a44",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "paraguay-alfaro",
    coach: "Gustavo Alfaro",
    country: "Paraguay",
    teamId: "par",
    points: 83,
    artUrl: "/trainer-cards/paraguay-alfaro.png",
    primary: "#d52b1e",
    secondary: "#0038a8",
    third: "#071b4f",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "ecuador-beccacece",
    coach: "Sebasti\u00e1n Beccacece",
    country: "Ecuador",
    teamId: "ecu",
    points: 84,
    artUrl: "/trainer-cards/ecuador-beccacece.png",
    primary: "#ffdd00",
    secondary: "#034ea2",
    third: "#ed1c24",
    light: "#fff7cc",
  }),
  createTrainerDemoCard({
    id: "suecia-potter",
    coach: "Graham Potter",
    country: "Suecia",
    teamId: "swe",
    points: 84,
    artUrl: "/trainer-cards/suecia-potter.png",
    primary: "#005293",
    secondary: "#fecb00",
    third: "#032b4f",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "senegal-thiaw",
    coach: "Pape Thiaw",
    country: "Senegal",
    teamId: "sen",
    points: 85,
    artUrl: "/trainer-cards/senegal-thiaw.png",
    primary: "#00853f",
    secondary: "#fdef42",
    third: "#e31b23",
    light: "#fff7cc",
  }),
  createTrainerDemoCard({
    id: "argentina-scaloni",
    coach: "Lionel Scaloni",
    country: "Argentina",
    teamId: "arg",
    points: 97,
    artUrl: "/trainer-cards/argentina-scaloni.png",
    primary: "#74acdf",
    secondary: "#f6b40e",
    third: "#0b3d75",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "austria-rangnick",
    coach: "Ralf Rangnick",
    country: "Austria",
    teamId: "aut",
    points: 88,
    artUrl: "/trainer-cards/austria-rangnick.png",
    primary: "#ed2939",
    secondary: "#ffffff",
    third: "#671019",
    light: "#fff5f5",
  }),
  createTrainerDemoCard({
    id: "argelia-petkovic",
    coach: "Vladimir Petkovi\u0107",
    country: "Argelia",
    teamId: "alg",
    points: 84,
    artUrl: "/trainer-cards/argelia-petkovic.png",
    primary: "#006233",
    secondary: "#d21034",
    third: "#073b2b",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "colombia-lorenzo",
    coach: "N\u00e9stor Lorenzo",
    country: "Colombia",
    teamId: "col",
    points: 90,
    artUrl: "/trainer-cards/colombia-lorenzo.png",
    primary: "#ffcd00",
    secondary: "#003087",
    third: "#c8102e",
    light: "#fff7cc",
  }),
  createTrainerDemoCard({
    id: "portugal-martinez",
    coach: "Roberto Mart\u00ednez",
    country: "Portugal",
    teamId: "por",
    points: 92,
    artUrl: "/trainer-cards/portugal-martinez.png",
    primary: "#006600",
    secondary: "#ff0000",
    third: "#7f0012",
    light: "#fff7cc",
  }),
  createTrainerDemoCard({
    id: "rd-congo-desabre",
    coach: "S\u00e9bastien Desabre",
    country: "RD Congo",
    teamId: "cod",
    points: 82,
    artUrl: "/trainer-cards/rd-congo-desabre.png",
    primary: "#00a3e0",
    secondary: "#f7d618",
    third: "#ce1021",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "inglaterra-tuchel",
    coach: "Thomas Tuchel",
    country: "Inglaterra",
    teamId: "eng",
    points: 93,
    artUrl: "/trainer-cards/inglaterra-tuchel.png",
    primary: "#f8fafc",
    secondary: "#cf142b",
    third: "#1f3a68",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "croacia-dalic",
    coach: "Zlatko Dali\u0107",
    country: "Croacia",
    teamId: "cro",
    points: 89,
    artUrl: "/trainer-cards/croacia-dalic.png",
    primary: "#f43f5e",
    secondary: "#ffffff",
    third: "#1d4ed8",
    light: "#ffffff",
  }),
  createTrainerDemoCard({
    id: "ghana-queiroz",
    coach: "Carlos Queiroz",
    country: "Ghana",
    teamId: "gha",
    points: 83,
    artUrl: "/trainer-cards/ghana-queiroz.png",
    primary: "#006b3f",
    secondary: "#fcd116",
    third: "#ce1126",
    light: "#fff7cc",
  }),
  createTrainerDemoCard({
    id: "placeholder-coach",
    coach: "Por determinar",
    country: "Por determinar",
    teamId: "",
    points: 0,
    artUrl: "/trainer-cards/placeholder-coach.png",
    primary: "#27272a",
    secondary: "#a1a1aa",
    third: "#09090b",
    light: "#f4f4f5",
  }),
];

export function TrainerFullArtCard({
  card,
  priority = false,
}: {
  card: TrainerDemoCard;
  priority?: boolean;
}) {
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
        priority={priority}
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
            {card.teamId ? (
              <TeamFlag teamId={card.teamId} className="h-full w-full" />
            ) : (
              <TeamFlag teamId="ger" className="h-full w-full saturate-0" />
            )}
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
