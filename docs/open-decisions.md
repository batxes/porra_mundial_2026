# Decisiones pendientes antes de abrir la porra

La interfaz y la base de datos admiten estas reglas, pero conviene fijarlas por escrito antes de
automatizar el cálculo:

1. ¿Un penalti marcado suma `+1` adicional al `+2` del gol, o suma `+1` en total?
2. Al acertar el marcador exacto de un partido, ¿se suman los goles totales del encuentro? En
   ese caso, ¿un `0-0` acertado vale `0` o debe tener un mínimo?
3. ¿Acertar qué selecciones avanzan vale `+1` en todas las rondas o debe aumentar en cuartos,
   semifinales y final?
4. ¿El once ideal puntúa únicamente por goles, penaltis, MVP y rojas, o también por paradas,
   asistencias, porterías a cero y tarjetas amarillas?
5. En premios colectivos como más rojas o equipo más goleador, ¿un empate concede los puntos a
   todos los acertantes?
6. ¿La porra completa de cada participante debe permanecer oculta hasta el primer partido? El
   esquema actual aplica esta opción para evitar copias.
7. El MVP reparte automáticamente los ocho mejores terceros entre las casillas compatibles del
   calendario FIFA. Antes de abrir la porra pública, hay que contrastar el algoritmo con el
   anexo reglamentario definitivo si FIFA publica una tabla de asignación más específica.

`supabase/schema.sql` incluye las reglas de ejemplo descritas inicialmente. El cálculo automático
debe implementarse después de resolver estas preguntas.
