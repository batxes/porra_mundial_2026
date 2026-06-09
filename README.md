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
- Panel admin para introducir y corregir resultados manualmente
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

Para conectar la web publicada con Supabase en GitHub Pages:

1. En GitHub, entra en el repositorio.
2. Ve a `Settings` -> `Secrets and variables` -> `Actions`.
3. Pulsa `New repository secret`.
4. Crea `NEXT_PUBLIC_SUPABASE_URL` con la URL del proyecto Supabase.
5. Crea `NEXT_PUBLIC_SUPABASE_ANON_KEY` con la publishable key de Supabase.
6. No subas nunca la `service_role` ni una secret key al navegador.

## API-Football opcional

```env
APIFOOTBALL_API_KEY=tu_api_key
```

GitHub Pages solo sirve archivos estáticos, así que no puede ejecutar una ruta server-side segura para API-Football. En GitHub Pages, usa el panel admin para meter resultados, goles, tarjetas y eventos manualmente.

Si quieres activar una integración automática con API-Football usando `APIFOOTBALL_API_KEY`, despliega la app en Vercel o en otro hosting con servidor, y añade la API route server-side allí.

## Publicar en GitHub Pages

El workflow `.github/workflows/pages.yml` publica automáticamente desde la rama `main`.

Pasos:

1. En GitHub, entra en `Settings` -> `Pages`.
2. En `Build and deployment`, selecciona `GitHub Actions`.
3. En `Settings` -> `Secrets and variables` -> `Actions`, añade las variables de Supabase si quieres usar la base de datos real.
4. Haz push a `main`.
5. Abre `Actions` y espera a que termine `Deploy static site to GitHub Pages`.
6. La web quedará en `https://batxes.github.io/porra_mundial_2026/`.

El despliegue ejecuta:

```bash
npm ci
npm run build
```

Después sube la carpeta `out/` generada por Next.js.

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

La integración puede prepararse para `API-Football` en un despliegue con servidor, porque ofrece plan gratuito y cobertura del Mundial 2026 con:

- fixtures
- standings
- top scorers
- top cards
- events / lineups / player stats según cobertura

En GitHub Pages, el panel admin funciona en modo manual porque no hay backend server-side.
