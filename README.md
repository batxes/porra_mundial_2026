# TRILIPORRA

Porra del Mundial 2026 refactorizada a `Next.js 16 + Tailwind 4`.

## Stack

- `Next.js` App Router
- `React 19`
- `Tailwind CSS 4`
- `Supabase` opcional para auth + persistencia
- `API-Football` opcional para resultados, goleadores y tarjetas

## Qué hay ya migrado

- Navegación real con rutas:
  - `/`
  - `/como-funciona`
  - `/porra`
  - `/partidos`
  - `/clasificacion`
  - `/perfil`
  - `/admin`
- Motor de puntuación portado a `src/lib/scoring.ts`
- Modelo de predicción portado a `src/lib/prediction.ts`
- Estado compartido con modo demo local y modo Supabase
- Panel admin con consulta server-side a `API-Football`
- Tests del scoring adaptados a TypeScript

## Desarrollo

```bash
npm install
npm run dev
```

La app corre en `http://localhost:3000`.

## Variables de entorno

Copia `.env.example` a `.env.local`.

### Demo local

No necesitas ninguna variable. La app funciona con `localStorage`.

Usuario admin demo:

- email: `admin@admin.admin`

## Supabase opcional

```env
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
```

## API-Football opcional

```env
APIFOOTBALL_API_KEY=tu_api_key
```

La ruta `src/app/api/provider/world-cup/route.ts:1` consulta:

- `league=1`
- `season=2026`

según la documentación pública de API-Sports para el Mundial 2026.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run check
```

## Datos legacy

Los ficheros históricos `data.js` y `schedule.js` siguen en la raíz como fuente.

Antes de `dev`, `build` y `test` se ejecuta:

```bash
npm run generate:data
```

Eso genera:

- `src/lib/generated/data.ts`
- `src/lib/generated/schedule.ts`

## Tests

```bash
npm run test
```

Valida:

- aciertos de marcador exacto
- eventos del once ideal
- simulación completa de los 104 partidos

## Estado actual de la API gratis

La integración está preparada para `API-Football`, porque hoy ofrece plan gratuito y cobertura del Mundial 2026 con:

- fixtures
- standings
- top scorers
- top cards
- events / lineups / player stats según cobertura

Si falta `APIFOOTBALL_API_KEY`, el panel admin sigue funcionando en modo manual/local.
