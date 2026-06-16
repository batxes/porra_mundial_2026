// Jugadores "estrella" (los mejores del mundo). Sirve para dos cosas:
//  1. Pool del Sobre Estrellas (/sobre-estrellas.png), que tira 1 carta.
//  2. RAREZA de las cartas: estar en esta lista = "legendaria" (la mayor); el
//     resto, "comun". Sustituye al sistema antiguo por umbrales de PUNTOS, que
//     era arbitrario (premiaba a un defensa goleador como si fuera un crack).
//
// Curada a mano por id: cada nombre+pais se verificó contra el dataset
// (`generated/data.ts`). El comentario es el nombre tal cual está en los datos.
export const STAR_PLAYER_IDS = [
  "esp-19", // Lamine Yamal
  "fra-10", // Kylian Mbappé
  "eng-09", // Harry Kane
  "fra-07", // Ousmane Dembélé
  "fra-11", // Michael Olise
  "nor-09", // Erling Haaland
  "bra-07", // Vinícius Júnior (Vini Jr.)
  "mar-02", // Achraf Hakimi
  "por-23", // Vitinha
  "esp-20", // Pedri
  "uru-08", // Federico Valverde
  "por-08", // Bruno Fernandes
  "arg-09", // Julián Álvarez
  "esp-16", // Rodri (Rodrigo)
  "bra-11", // Raphinha
  "arg-10", // Lionel Messi
  "por-15", // João Neves
  "eng-10", // Jude Bellingham
  "eng-04", // Declan Rice
  "ecu-23", // Moisés Caicedo
  "bra-03", // Gabriel Magalhães (Gabriel)
  "ger-17", // Florian Wirtz
  "col-07", // Luis Díaz
  "gha-11", // Antoine Semenyo
  "arg-22", // Lautaro Martínez
  "eng-07", // Bukayo Saka
  "ned-04", // Virgil van Dijk
  "ger-06", // Joshua Kimmich
  "can-19", // Alphonso Davies
  "por-10", // Bernardo Silva (Bernardo)
  "ger-10", // Jamal Musiala
  "cro-10", // Luka Modrić
  "por-25", // Nuno Mendes
  "ned-22", // Denzel Dumfries
  "bel-07", // Kevin De Bruyne
  "fra-20", // Désiré Doué
  "bel-11", // Jérémy Doku
  "por-07", // Cristiano Ronaldo
  "fra-24", // Rayan Cherki
  "ger-02", // Antonio Rüdiger
  "fra-13", // N'Golo Kanté
  "bel-01", // Thibaut Courtois
  "ned-14", // Tijjani Reijnders
  "por-03", // Rúben Dias
  "bra-08", // Bruno Guimarães
  "arg-23", // Emiliano Martínez
  "ned-21", // Frenkie de Jong
  "esp-24", // Marc Cucurella
  "sen-10", // Sadio Mané
  "esp-18", // Martín Zubimendi
  "esp-17", // Nico Williams (Williams Jr)
  "arg-24", // Enzo Fernández
  "nor-10", // Martin Ødegaard
  "ecu-06", // Willian Pacho
  "sco-04", // Scott McTominay
  "ned-08", // Ryan Gravenberch
  "egy-10", // Mohamed Salah
  "ned-11", // Cody Gakpo
  "cro-04", // Joško Gvardiol
  "fra-15", // Ibrahima Konaté
  "bra-01", // Alisson (A. Becker)
  "esp-22", // Pau Cubarsí
  "bra-04", // Marquinhos
  "fra-17", // William Saliba
  "fra-16", // Mike Maignan
  "sen-18", // Ismaïla Sarr
  "por-17", // Rafael Leão
  "arg-20", // Alexis Mac Allister
  "usa-08", // Weston McKennie
  "bra-22", // Gabriel Martinelli
  "por-20", // João Cancelo
  "esp-10", // Dani Olmo
  "swe-17", // Viktor Gyökeres
  "tur-08", // Arda Güler
  "usa-10", // Christian Pulisic
  "fra-05", // Jules Koundé
  "kor-07", // Son Heung-min (Heungmin)
  "eng-24", // Reece James
  "eng-06", // Marc Guéhi
  "esp-08", // Fabián Ruiz
  "bra-05", // Casemiro
  "esp-06", // Mikel Merino
  "eng-21", // Eberechi Eze
  "tur-11", // Kenan Yıldız (Yildiz)
  "mex-09", // Raúl Jiménez
  "por-09", // Gonçalo Ramos
  "esp-21", // Mikel Oyarzabal
  "fra-09", // Marcus Thuram
  "arg-06", // Lisandro Martínez (Martínez)
  "fra-12", // Bradley Barcola
  "kor-04", // Kim Min-jae (Minjae)
  "swe-09", // Alexander Isak
  "ecu-07", // Pervis Estupiñán
];

// Set para consultar rareza rápido (lo usa PlayerCard).
export const starPlayerIds = new Set(STAR_PLAYER_IDS);
