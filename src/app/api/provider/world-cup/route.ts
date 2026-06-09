import { NextResponse } from "next/server";

import { getWorldCupProviderSummary, hasApiFootballKey, WORLD_CUP_LEAGUE_ID, WORLD_CUP_SEASON } from "@/lib/server/api-football";

export async function GET() {
  if (!hasApiFootballKey()) {
    return NextResponse.json(
      {
        error: `Falta configurar APIFOOTBALL_API_KEY. Esta ruta espera World Cup league=${WORLD_CUP_LEAGUE_ID} y season=${WORLD_CUP_SEASON}.`,
      },
      { status: 400 },
    );
  }

  try {
    const payload = await getWorldCupProviderSummary();
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se ha podido consultar la API.",
      },
      { status: 500 },
    );
  }
}
