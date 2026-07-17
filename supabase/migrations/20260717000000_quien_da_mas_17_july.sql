-- Nueva edición diaria de Quién da más. Las respuestas están equilibradas:
-- seis ganan a la izquierda y seis a la derecha.

insert into public.quien_da_mas_games (id, title, duel_time_ms, duels, rewards)
values (
  '00000000-0000-0000-0000-0000000000f4'::uuid,
  '¿QUIÉN DA MÁS? · 17 JUL',
  10000,
  $duels$
  [
    {
      "id": "edad-messi-cristiano-2024", "question": "¿Quién era mayor el 31 de diciembre de 2024?", "metricLabel": "a esa fecha", "format": "age",
      "a": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 37.5205479452 },
      "b": { "id": "cristiano", "name": "Cristiano", "teamCode": "pt", "teamName": "Portugal", "image": "/cristiano.webp", "value": 39.9041095890 }
    },
    {
      "id": "primer-mundial-messi-neymar", "question": "¿Quién marcó más goles en su primer Mundial?", "metricLabel": "goles en su debut mundialista", "format": "int",
      "a": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 1 },
      "b": { "id": "neymar", "name": "Neymar", "teamCode": "br", "teamName": "Brasil", "image": "/neymar.webp", "value": 4 }
    },
    {
      "id": "balones-oro-messi-cristiano-2024", "question": "¿Quién tenía más Balones de Oro al acabar 2024?", "metricLabel": "Balones de Oro", "format": "int",
      "a": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 8 },
      "b": { "id": "cristiano", "name": "Cristiano", "teamCode": "pt", "teamName": "Portugal", "image": "/cristiano.webp", "value": 5 }
    },
    {
      "id": "champions-vinicius-neymar-2024", "question": "¿Quién había ganado más Champions a junio de 2024?", "metricLabel": "Champions League", "format": "int",
      "a": { "id": "vinicius", "name": "Vinícius", "teamCode": "br", "teamName": "Brasil", "image": "/vinicius.webp", "value": 2 },
      "b": { "id": "neymar", "name": "Neymar", "teamCode": "br", "teamName": "Brasil", "image": "/neymar.webp", "value": 1 }
    },
    {
      "id": "finales-champions-messi-cristiano", "question": "¿Quién marcó más goles en finales de Champions?", "metricLabel": "goles en finales", "format": "int",
      "a": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 2 },
      "b": { "id": "cristiano", "name": "Cristiano", "teamCode": "pt", "teamName": "Portugal", "image": "/cristiano.webp", "value": 4 }
    },
    {
      "id": "goles-mundial-2014-cristiano-neymar", "question": "¿Quién marcó más goles en el Mundial de Brasil 2014?", "metricLabel": "goles en Brasil 2014", "format": "int",
      "a": { "id": "cristiano", "name": "Cristiano", "teamCode": "pt", "teamName": "Portugal", "image": "/cristiano.webp", "value": 1 },
      "b": { "id": "neymar", "name": "Neymar", "teamCode": "br", "teamName": "Brasil", "image": "/neymar.webp", "value": 4 }
    },
    {
      "id": "mundiales-francia-brasil-2022", "question": "¿La selección de quién tenía más Mundiales al acabar 2022?", "metricLabel": "Copas del Mundo", "format": "int",
      "a": { "id": "mbappe", "name": "Mbappé", "teamCode": "fr", "teamName": "Francia", "image": "/mbappe.webp", "value": 2 },
      "b": { "id": "neymar", "name": "Neymar", "teamCode": "br", "teamName": "Brasil", "image": "/neymar.webp", "value": 5 }
    },
    {
      "id": "poblacion-brasil-portugal-2022", "question": "¿La selección de quién tenía más habitantes en 2022?", "metricLabel": "habitantes del país", "format": "compact",
      "a": { "id": "neymar", "name": "Neymar", "teamCode": "br", "teamName": "Brasil", "image": "/neymar.webp", "value": 203062512 },
      "b": { "id": "cristiano", "name": "Cristiano", "teamCode": "pt", "teamName": "Portugal", "image": "/cristiano.webp", "value": 10467366 }
    },
    {
      "id": "superficie-noruega-belgica", "question": "¿El país de quién tiene más superficie?", "metricLabel": "km² de superficie", "format": "compact",
      "a": { "id": "haaland", "name": "Haaland", "teamCode": "no", "teamName": "Noruega", "image": "/halland.webp", "value": 385207 },
      "b": { "id": "courtois", "name": "Courtois", "teamCode": "be", "teamName": "Bélgica", "image": "/courtois.webp", "value": 30689 }
    },
    {
      "id": "ecuador-mbappe-vinicius", "question": "¿Quién nació más lejos del ecuador?", "metricLabel": "km hasta el ecuador", "format": "int",
      "a": { "id": "mbappe", "name": "Mbappé", "teamCode": "fr", "teamName": "Francia", "image": "/mbappe.webp", "value": 5437 },
      "b": { "id": "vinicius", "name": "Vinícius", "teamCode": "br", "teamName": "Brasil", "image": "/vinicius.webp", "value": 2538 }
    },
    {
      "id": "cantera-messi-mbappe", "question": "¿Quién pasó por una cantera fundada hace más tiempo?", "metricLabel": "años de historia en 2024", "format": "int",
      "a": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 121 },
      "b": { "id": "mbappe", "name": "Mbappé", "teamCode": "fr", "teamName": "Francia", "image": "/mbappe.webp", "value": 46 }
    },
    {
      "id": "nacimiento-messi-haaland", "question": "¿Quién nació más recientemente?", "metricLabel": "año de nacimiento", "format": "int",
      "a": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 1987 },
      "b": { "id": "haaland", "name": "Haaland", "teamCode": "no", "teamName": "Noruega", "image": "/halland.webp", "value": 2000 }
    }
  ]
  $duels$::jsonb,
  '[
    { "minScore": 3, "pool": "medios" },
    { "minScore": 6, "pool": "delanteros" },
    { "minScore": 9, "pool": "defensas" },
    { "minScore": 12, "pool": "stars" }
  ]'::jsonb
) on conflict (id) do update
set title = excluded.title,
    duel_time_ms = excluded.duel_time_ms,
    duels = excluded.duels,
    rewards = excluded.rewards,
    updated_at = now();

-- Conserva el estado activo/pausado que eligió el admin, pero hace que la
-- próxima apertura use la nueva edición y permita un intento nuevo por usuario.
update public.quien_da_mas_settings
set active_game_id = '00000000-0000-0000-0000-0000000000f4'::uuid,
    updated_at = now()
where id = true;
