# TRILIPORRA

MVP estático y responsive para una porra del Mundial 2026. Incluye registro, perfil, editor de
pronósticos, grupos oficiales, cuadro encadenado de eliminatorias, marcadores exactos por
partido, premios especiales, once ideal, calendario completo, resultados administrables y
clasificación pública.

## Abrir la demo

```bash
cd /Users/iirastorza/trilita_porra
python3 -m http.server 4173
```

Visita `http://localhost:4173`. Sin configuración adicional, el registro y la porra se guardan
en `localStorage` para poder probar el flujo completo.

La demo local crea automáticamente este usuario administrador:

- Email: `admin@admin.admin`
- Contraseña: `admin`

Ese usuario aparece en la pestaña `Admin` y puede publicar/corregir resultados, añadir eventos,
resetear contraseñas locales, borrar usuarios locales y cambiar roles. En la demo, la contraseña
se guarda como hash SHA-256 en el navegador; en producción debe gestionarla Supabase Auth.

## Comprobar que funciona

```bash
node --check app.js
node --check scoring.js
node --check data.js
node --check schedule.js
node tests/scoring.test.js
curl -sS -o /dev/null -w "index=%{http_code}\n" http://localhost:4173/
```

El test de puntuación comprueba, entre otras cosas, que un pronóstico `2-2` recibe 4 puntos
cuando el admin valida `2-2`, y que baja a 0 si el admin corrige el resultado a `2-1`.

## Base de datos real

La combinación recomendada es:

- [Vercel](https://vercel.com/) para servir esta web estática.
- [Supabase Free](https://supabase.com/pricing) para autenticación y PostgreSQL.
- Una GitHub Action programada, o una tarea externa, para importar resultados mediante un
  proveedor autorizado si más adelante quieres automatizar lo que ahora hace el admin.

Crea un proyecto de Supabase, ejecuta `supabase/schema.sql` y después `supabase/seed.sql` en el
editor SQL. Luego completa los valores públicos de `config.js`:

```js
window.PORRA_CONFIG = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseAnonKey: "TU_ANON_KEY",
  adminEmails: ["admin@admin.admin"],
};
```

La clave `anon` se puede publicar porque las políticas RLS del esquema protegen los datos. No
publiques nunca la clave `service_role`.

Para activar el administrador en producción:

1. En Supabase, ve a `Authentication > Users`.
2. Crea el usuario `admin@admin.admin` con contraseña `admin`.
3. Ejecuta `supabase/migration-005-default-admin.sql` para marcar ese perfil como administrador.
4. Entra en la web con ese usuario y cambia la contraseña desde Supabase si vas a compartir la
   web públicamente.

Supabase Auth guarda las contraseñas hasheadas; esta app nunca muestra ni lee contraseñas reales.

Si ya habías ejecutado una versión anterior de `schema.sql`, ejecuta también
`supabase/migration-002-admin-and-definitive.sql`, después
`supabase/migration-003-automatic-scoring.sql`, después
`supabase/migration-004-admin-user-management.sql` y después
`supabase/migration-005-default-admin.sql`.

## GitHub y Vercel

Instala las CLI si no las tienes:

```bash
brew install node
brew install gh
npm install -g vercel
```

Publica el código en GitHub:

```bash
cd /Users/iirastorza/trilita_porra
git init
git add .
git commit -m "Initial TRILIPORRA app"
gh auth login
gh repo create triliporra --private --source . --remote origin --push
```

Si quieres que el repositorio sea público, cambia `--private` por `--public`.

Despliega en Vercel:

```bash
vercel login
vercel
vercel --prod
```

Cuando Vercel pregunte por el framework, elige `Other`. No hace falta build command ni output
directory porque es una web estática con `index.html` en la raíz. Si ya has rellenado
`config.js` con Supabase, Vercel publicará la versión conectada a la base de datos real.

Después del despliegue, comparte con tus amigos la URL final que te devuelva `vercel --prod`.

## Publicar con Codex Sites

Sites se usa desde el plugin `@Sites` de Codex. Cuando lo tengas activado, abre un hilo nuevo en
Codex desde esta carpeta y usa:

```text
@Sites Deploy this project. It is a static web app served from index.html.
Check compatibility, save a reviewable version first, then deploy the approved version and give me the production URL.
```

Si necesitas datos persistentes reales para todos tus amigos, añade en el prompt que use Supabase
con la configuración de `config.js`, o que prepare almacenamiento relacional de Sites si tu plan
lo permite.

## Estado del MVP

- El modo demo funciona enteramente en el navegador.
- La autenticación y el guardado de `predictions` ya tienen adaptador para Supabase.
- El usuario local `admin@admin.admin` / `admin` se crea automáticamente como administrador de
  demo.
- Una porra puede guardarse como borrador o confirmarse como definitiva. Supabase impide
  modificarla después de esa confirmación.
- Los participantes pueden pronosticar marcadores de los partidos visibles. Cada marcador se
  puede editar hasta la hora de inicio del encuentro.
- La pestaña `Admin` permite publicar resultados y añadir goles, tarjetas, penaltis y MVP. En
  la demo local también permite administrar usuarios básicos.
- Cada cambio del admin recalcula los puntos desde cero: marcadores exactos, eventos del once,
  posiciones de grupo cerradas, cruces de eliminatorias y campeón cuando estén disponibles.
- El esquema contiene partidos, eventos, estadísticas, reglas de puntuación, libro mayor e
  historial de importaciones.
- La semilla SQL incorpora las 48 selecciones de los grupos publicados por FIFA.
- `schedule.js` incorpora los 104 partidos y fechas publicados. Los cruces eliminatorios aún
  no decididos conservan la plaza oficial correspondiente.
- El catálogo corto de jugadores es demostrativo. Debe reemplazarse por convocatorias FIFA
  validadas antes de abrir la porra.

La estrategia de datos está documentada en `docs/data-sources.md`. Las reglas que conviene
cerrar antes de automatizar el cálculo están recopiladas en `docs/open-decisions.md`.
