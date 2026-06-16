import type { Position } from "@/lib/types";

// Acento por posición para las cartas de jugador. `rgb` se usa en glows/anillos
// (rgba(...)), `text` es el color sólido para chip de posición y puntos.
// Reusa la paleta de la app: DEF cian (acento principal), MED verde campo,
// y POR dorado / DEL rosa para completar. El dorado del portero hace de
// "legendario" natural (un gol de POR vale +35).
//
// `bgRotate` (grados): el fondo de carta `cardbg.png` viene AZUL (~217°). Cada
// puesto lo recolorea con hue-rotate para conservar su identidad de color sin
// cambiar la textura/arcos. DEF queda en 0 (es el azul nativo de la imagen).
export const positionAccent: Record<
  Position,
  { rgb: string; text: string; bgRotate: number }
> = {
  POR: { rgb: "245, 184, 30", text: "#f7c84a", bgRotate: 190 },
  DEF: { rgb: "56, 189, 248", text: "#7dd8fb", bgRotate: 0 },
  MED: { rgb: "52, 211, 153", text: "#5fe3b0", bgRotate: -60 },
  DEL: { rgb: "251, 113, 133", text: "#fda4af", bgRotate: 133 },
};
