import type { Position } from "@/lib/types";

// Acento por posición para las cartas de jugador. `rgb` se usa en glows/anillos
// (rgba(...)), `text` es el color sólido para chip de posición y puntos.
// Reusa la paleta de la app: DEF cian (acento principal), MED verde campo,
// y POR dorado / DEL rosa para completar. El dorado del portero hace de
// "legendario" natural (un gol de POR vale +35).
export const positionAccent: Record<Position, { rgb: string; text: string }> = {
  POR: { rgb: "245, 184, 30", text: "#f7c84a" },
  DEF: { rgb: "56, 189, 248", text: "#7dd8fb" },
  MED: { rgb: "52, 211, 153", text: "#5fe3b0" },
  DEL: { rgb: "251, 113, 133", text: "#fda4af" },
};
