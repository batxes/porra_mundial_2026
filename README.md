# TRILIPORRA

World Cup 2026 prediction pool refactored to `Next.js 16 + Tailwind 4`.

## Stack

- `Next.js` App Router
- `React 19`
- `Tailwind CSS 4`
- `Supabase` optional for auth + persistence
- `API-Football` optional for results, scorers and cards

## Already migrated

- Real navigation with routes:
  - `/`
  - `/como-funciona`
  - `/porra`
  - `/partidos`
  - `/clasificacion`
  - `/perfil`
  - `/admin`
- Scoring engine ported to `src/lib/scoring.ts`
- Prediction model ported to `src/lib/prediction.ts`
- Shared state with local demo mode and Supabase mode
- Admin panel with server-side query to `API-Football`
- Scoring tests adapted to TypeScript

## Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

## Deploying to Vercel

Deployment is handled by GitHub Actions with the Vercel CLI (`.github/workflows/deploy.yml`). Every push to `main` builds and publishes to production, running Next.js with a server (server components, `/api` routes, server-side `API-Football` calls).

Configure in GitHub (`Settings > Secrets and variables > Actions`):

- `VERCEL_TOKEN` — Vercel account token
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The two IDs come from `vercel link` (the `.vercel/project.json` file) or from the Vercel dashboard. The app's environment variables (Supabase, API-Football) are configured in the Vercel project; `vercel pull` downloads them during the build.

## Environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

### Local demo

You don't need any variable. The app works with `localStorage`.

Demo admin user:

- email: `admin@admin.admin`

## Optional Supabase

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### Local Supabase (Docker)

Runs the full Supabase stack (Postgres + Auth + API + Studio) locally via the Supabase CLI, which manages its own Docker containers.

One-time setup:

```bash
brew install supabase/tap/supabase   # or see supabase.com/docs
open -a Docker                        # Docker must be running
```

Then, from the repo root:

```bash
npm run db:setup     # init config, start the stack, apply schema + seed
```

From the `db:setup` output, copy two values into `.env.local`:

- **Project URL** (under `APIs`) → `NEXT_PUBLIC_SUPABASE_URL`
- **Publishable** key (under `Authentication Keys`, starts with `sb_publishable_`; this is the public/anon key) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

Never put the **Secret** key (`sb_secret_…`) in a `NEXT_PUBLIC_*` variable. Re-print these anytime with `npm run db:status`.

Other commands:

```bash
npm run db:reset     # drop and re-apply migrations + seed
npm run db:status    # show local URLs and keys
npm run db:stop      # stop the containers
```

Studio (DB browser) is at `http://127.0.0.1:54323`.

The schema and reference data (teams, players, tournament, scoring rules) live in `supabase/migrations/` and reach every environment. `supabase/seed.sql` is **local-only** (run on `db reset`, never on `db push`) and just seeds a dev admin:

- email: `admin@admin.admin`
- password: `admin1234`

### First admin in production

`seed.sql` does not run against production, so create the admin once by hand:

1. Register `admin@admin.admin` through the app.
2. In the Supabase SQL editor run:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'admin@admin.admin');
```

From then on that admin manages other users from the Admin panel.

## Optional API-Football

```env
APIFOOTBALL_API_KEY=your_api_key
```

The `src/app/api/provider/world-cup/route.ts:1` route queries:

- `league=1`
- `season=2026`

according to the public API-Sports documentation for World Cup 2026.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run check
```

## Legacy data

The historical files `data.js` and `schedule.js` remain at the root as the source.

Before `dev`, `build` and `test`, this runs:

```bash
npm run generate:data
```

That generates:

- `src/lib/generated/data.ts`
- `src/lib/generated/schedule.ts`

## Tests

```bash
npm run test
```

Validates:

- exact-score hits
- best-XI events
- full simulation of all 104 matches

## Current state of the free API

The integration is ready for `API-Football`, since it currently offers a free plan and World Cup 2026 coverage with:

- fixtures
- standings
- top scorers
- top cards
- events / lineups / player stats depending on coverage

If `APIFOOTBALL_API_KEY` is missing, the admin panel keeps working in manual/local mode.
