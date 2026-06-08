# Fuentes de datos y criterio de validación

## Recomendación

La fuente de verdad debe ser siempre FIFA:

- [Calendario, resultados y sedes del Mundial 2026](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums)
- [PDF oficial del calendario de 104 partidos](https://digitalhub.fifa.com/m/1be9ce37eb98fcc5/original/FWC26-Match-Schedule_English.pdf)
- [Football Data Platform de FIFA](https://fdp.fifa.org/)
- [Ejemplo de informe oficial versionado](https://fdp.fifa.org/assetspublic/ce233/r10550/pdf/FullTimeMatchReport-English.pdf)

Los informes oficiales publicados desde la Football Data Platform son la referencia más
rigurosa. Incluyen versión y advierten de que los datos recogidos en directo están sujetos a
cambios. No debe presuponerse que existe una API anónima documentada para consumir desde el
frontend, ni construirse una integración contra endpoints privados no documentados.

Para automatizar una web pública sin acceso acreditado, la mejor opción profesional es
[Sportradar Soccer API v4](https://developer.sportradar.com/soccer/docs/soccer-ig-api-basics).
Su API B2B incluye estadísticas, alineaciones, eventos, resultados y feeds para detectar
revisiones posteriores a los partidos. Antes de contratarla hay que confirmar por escrito la
cobertura exacta del Mundial 2026 y el derecho de republicación.

Para desarrollar sin coste puede utilizarse
[API-Football](https://www.api-football.com/pricing) como fuente provisional: el plan gratuito
incluye 100 peticiones diarias. La cobertura detallada debe verificarse por competición y
temporada; no es suficiente como única fuente para adjudicar puntos definitivos.

## Flujo de importación

1. Importar cada jornada desde el proveedor autorizado; Sportradar dispone de
   [resúmenes diarios](https://developer.sportradar.com/soccer/reference/soccer-daily-summaries).
2. Guardar la respuesta original, URL de origen, fecha de descarga y hash SHA-256 en
   `data_import_runs` y `match_source_versions`.
3. Normalizar equipos, jugadores, eventos y estadísticas sin borrar la versión original.
4. Comparar el acta con FIFA cuando esté disponible.
5. Marcar el partido como `validated` tras revisión. Solo entonces aparece públicamente y se
   recalculan puntos.
6. Si llega una corrección posterior, crear una versión adicional y recalcular el libro mayor
   `score_entries`.

No conviene parsear HTML privado ni automatizar páginas con medidas anti-bot. El importador
debe consumir únicamente APIs contratadas o documentos oficiales públicos permitidos.

## Convocatorias

El archivo `data.js` incluye un catálogo corto de jugadores para demostrar la interfaz. Antes
de abrir la porra, hay que sustituirlo por las convocatorias definitivas verificadas por FIFA y
marcar esos registros como `validated` en `players`.
