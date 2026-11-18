//#region Conexiones con la API de Riot Games
// La API key ya NO vive en el frontend: esta guardada como secreto en el
// Cloudflare Worker del proyecto (carpeta `holy-mouse-2e50`). El Worker agrega
// el header `X-Riot-Token` a cada peticion por nosotros.
// Cambia esta URL por la que te devuelve `wrangler deploy`.
const API_BASE = "https://lol-analyzer-api.demiandenegri.workers.dev"; // proxy propio en Cloudflare

// links base: el Worker traduce la region al host real de Riot
const RIOT_AMERICAS = API_BASE + "/americas"; // servidor de cuentas y partidas
const RIOT_LA2 = API_BASE + "/la2"; // servidor de la region LAN

const URL_CUENTA_POR_RIOT_ID =
  RIOT_AMERICAS + "/riot/account/v1/accounts/by-riot-id/"; // cuenta del invocador por nombre y tag
const URL_CUENTA_POR_PUUID =
  RIOT_AMERICAS + "/riot/account/v1/accounts/by-puuid/"; // cuenta del invocador por puuid
const URL_INVOCADOR_POR_PUUID =
  RIOT_LA2 + "/lol/summoner/v4/summoners/by-puuid/"; // datos del invocador
const URL_MAESTRIA_POR_PUUID =
  RIOT_LA2 + "/lol/champion-mastery/v4/champion-masteries/by-puuid/"; // maestria de campeones
const URL_RANKED_POR_PUUID = RIOT_LA2 + "/lol/league/v4/entries/by-puuid/"; // estadisticas de ranked
const URL_PARTIDAS_POR_PUUID =
  RIOT_AMERICAS + "/lol/match/v5/matches/by-puuid/"; // ids del historial de partidas
const URL_PARTIDA_POR_ID = RIOT_AMERICAS + "/lol/match/v5/matches/"; // detalles de una partida

// links base de las imagenes de data dragon
const DDDRAGON = "https://ddragon.leagueoflegends.com"; // servidor de imagenes y datos del juego
const DDDRAGON_VERSION = "14.20.1"; // version del parche
const URL_CAMPEON_POR_NOMBRE =
  DDDRAGON + "/cdn/" + DDDRAGON_VERSION + "/img/champion/"; // imagen del campeon
//#endregion
const profiles = {};

function leerJugadores() {
  const jugadores = []; // creo un array de objetos donde guardo los datos de los invocadores que se van a buscar
  for (let i = 1; i <= 5; i++) {
    let nombre = document.getElementById(`nombreInvocador${i}`).value.trim(); // el trim es para quitar los espacios en blanco al principio y al final del string
    let tag = document.getElementById(`tag${i}`).value.trim();
    if (nombre != "" && tag != "") {
      jugadores.push({
        nombre: nombre,
        tag: tag,
      });
    }
  }
  return jugadores;
}

async function getProfile(nombre, tag) {
  // obrengo los datos del perfil del invocador y los guardo en el objeto profiles(DE ACA SACO EL PUUID DEL INVOCADOR).

  const response = await fetch(
    URL_CUENTA_POR_RIOT_ID +
      encodeURIComponent(nombre) + // encode para que los espacios en blanco y caracteres especiales no rompan la url
      "/" +
      encodeURIComponent(tag),
  );
  const account = await response.json(); // guardo en account el objeto que contiene los datos del invocador

  const datoJugador = await buildProfile(account);
  profiles[account.puuid] = datoJugador; // junto y guardo el perfil del invocador en el objeto profiles usando su puuid como clave
  return datoJugador;
}

async function buildProfile(account) {
  // construyo el perfil del invocador y lo devuelvo como un objeto

  const puuid = account.puuid;

  // obtengo los datos del invocador
  const [summoner, ranked, mastery, FullMatchHistory] = await Promise.all([
    getSummoner(puuid),
    getRanckedStats(puuid),
    getChampionMastery(puuid),
    getFullMatchHistory(puuid),
  ]);
  const curedMatchHistory = getCureMatchHistory(FullMatchHistory); // llamo a la funcion getCureMatchHistory y le paso el FullMatchHistory.
  return {
    puuid: puuid, // puuid del invocador
    name: account.gameName, //nombre del invocador
    level: summoner.summonerLevel, // nivel del invocador
    ranked: ranked, // stats del invocador en ranked
    mastery: mastery, // maestria de campeones del invocador
    fullMatchHistory: FullMatchHistory, // historial de partidas del invocador
    curedMatchHistory: curedMatchHistory, // historial de partidas del invocador ya curado
  };
}

async function getSummoner(puuid) {
  // cuenta de invocador del user LOL

  const response = await fetch(URL_INVOCADOR_POR_PUUID + puuid);
  const summoner = await response.json(); // esta linea es para esperarr a que la respuesta se convierta en json
  return summoner;
}

async function getSummonerName(puuid) {
  // obtengo el nombre del invocador del user LOL
  const response = await fetch(URL_CUENTA_POR_PUUID + puuid);
  const account = await response.json();
  return account;
}

async function getChampionMastery(puuid) {
  // obtengo la maestria de campeones del user LOL(devuelve un array de objetos con la maestria de campeones)
  const response = await fetch(URL_MAESTRIA_POR_PUUID + puuid);
  const championMastery = await response.json(); // esta linea es para esperarr a que la respuesta se convierta en json
  return championMastery;
}

async function getRanckedStats(puuid) {
  // obtengo las estadisticas de ranked del user LOL

  const response = await fetch(URL_RANKED_POR_PUUID + puuid);
  const rankedStats = await response.json();
  return rankedStats;
}

//---------------------------//
//---HISTORIAL DE PARTIDAS---//
//---------------------------//

async function getMatchHistory(puuid) {
  // obtengo los id del historial de partidas del user LOL
  const response = await fetch(
    URL_PARTIDAS_POR_PUUID + puuid + "/ids?start=0&count=10", // 10 es la cantidad de partidas que quiero obtener del historial de partidas del user LOL
  );
  const matchHistory = await response.json(); // esta linea es para esperarr a que la respuesta se convierta en json
  return matchHistory;
}

async function getMatchDetails(matchId) {
  // obtengo los detalles de una partida específica(le paso el uno de los id del historial de partidas del user LOL)
  const response = await fetch(URL_PARTIDA_POR_ID + matchId);
  const matchDetails = await response.json();
  return matchDetails;
}

async function getFullMatchHistory(puuid) {
  // obtengo el historial de partidas del user LOL y los detalles de cada partida
  const Partidas = []; // array donde guardo los detalles de cada partida del historial de partidas del user LOL
  //espero a que se resuelva la promesa de getMatchHistory y guardo el resultado en respuesta
  const respuesta = await getMatchHistory(puuid);
  for (let i = 0; i < respuesta.length; i++) {
    const detalles = await getMatchDetails(respuesta[i]);
    Partidas.push(detalles); // guardo los detalles de cada partida en el array Partidas
  }
  return Partidas; // devuelvo el array Partidas con los detalles de cada partida del historial de partidas del user LOL
}

function getCureMatchHistory(partida) {
  // curo los datos del historial de partidas del user LOL y los guardo en un array de objetos
  const CuredPartidas = []; // array donde guardo los detalles de cada partida ya limpios
  for (let i = 0; i < partida.length; i++) {
    // i = partidas
    const partidaCura = [];
    for (let j = 0; j < partida[i].info.participants.length; j++) {
      // j = datos de la partida
      partidaCura.push({
        puuid: partida[i].info.participants[j].puuid, // puuid del invocador
        invocatorName: partida[i].info.participants[j].riotIdGameName, // nombre del invocador
        championName: partida[i].info.participants[j].championName, // nombre del campeon
        kills: partida[i].info.participants[j].kills, // cantidad de kills
        deaths: partida[i].info.participants[j].deaths, // cantidad de muertes
        assists: partida[i].info.participants[j].assists, // cantidad de asistencias
        win: partida[i].info.participants[j].win, // si gano o perdio la partida
        lane: partida[i].info.participants[j].lane, // lane en la que jugo
        goldEarned: partida[i].info.participants[j].goldEarned, // oro ganado
        totalDamageDealtToChampions:
          partida[i].info.participants[j].totalDamageDealtToChampions, // daño total hecho a campeones
        totalDamageTaken: partida[i].info.participants[j].totalDamageTaken, // daño total recibido
        totalMinionsKilled: partida[i].info.participants[j].totalMinionsKilled, // cantidad de minions matados
        visionScore: partida[i].info.participants[j].visionScore, // score de vision
        timePlayed: partida[i].info.gameDuration, // duracion de la partida
        championLevel: partida[i].info.participants[j].champLevel, // nivel del campeon
        summoner1Id: partida[i].info.participants[j].summoner1Id, // hechizo 1
        summoner2Id: partida[i].info.participants[j].summoner2Id, // hechizo 2
        role: partida[i].info.participants[j].individualPosition, // posicion en la que quedo respecto a los demas

        items: [
          partida[i].info.participants[j].item0,
          partida[i].info.participants[j].item1,
          partida[i].info.participants[j].item2,
          partida[i].info.participants[j].item3,
          partida[i].info.participants[j].item4,
          partida[i].info.participants[j].item5,
          partida[i].info.participants[j].item6,
        ],
        runes: [
          partida[i].info.participants[j].perks.styles[0].selections[0].perk,
          partida[i].info.participants[j].perks.styles[0].selections[1].perk,
          partida[i].info.participants[j].perks.styles[0].selections[2].perk,
          partida[i].info.participants[j].perks.styles[0].selections[3].perk,
        ],
      });
    }

    CuredPartidas.push(partidaCura);
  }
  return CuredPartidas;
}

function calcularStats(perfil) {
  //calcuulo las estas del perfil que le mando
  let partidasAnalizadas = 0;
  let tiempoEnPartida = 0;
  /////////////////
  let wins = 0;
  let winrate = 0;
  /////////////////
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let kda = 0;
  let divisor;
  /////////////////
  let oroTotal = 0;
  let oroPorMinuto = 0;
  /////////////////
  let csTotal = 0;
  let csPorMinuto = 0;
  /////////////////
  let dañoTotal = 0;
  let dañoPorMinuto = 0;
  /////////////////
  let visionTotal = 0;
  let visionPorMinuto = 0;
  /////////////////
  let score = 0;

  for (let i = 0; i < perfil.curedMatchHistory.length; i++) {
    // recorro el historial de partidas del perfil
    let fila = perfil.curedMatchHistory[i].find(
      // busco en el historial de partidas del perfil la fila que corresponde al invocador
      (p) => p.puuid === perfil.puuid,
    );
    if (fila === undefined) {
      // si no encuentra la fila correspondiente al invocador, muestro un error en la consola
      console.error("No se encontró el jugador en la partida " + i);
      continue; // paso a la siguiente iteracion del bucle
    }
    partidasAnalizadas++; // si encuentra la fila correspondiente al invocador, sumo 1 a las partidas analizadas
    if (fila.win) {
      wins++; // si gano la partida, sumo 1 a las victorias
    }
    tiempoEnPartida += Number(fila.timePlayed) || 0;
    oroTotal += Number(fila.goldEarned) || 0;
    csTotal += Number(fila.totalMinionsKilled) || 0;

    kills += Number(fila.kills) || 0;
    deaths += Number(fila.deaths) || 0;
    assists += Number(fila.assists) || 0;

    dañoTotal += Number(fila.totalDamageDealtToChampions) || 0;
    visionTotal += Number(fila.visionScore) || 0;
  } //fin del for
  divisor = deaths;
  if (divisor === 0 || divisor === undefined) {
    divisor = 1; // si el invocador no tiene muertes, el divisor es 1 para evitar la division por 0
  }
  try {
    let tiempoEnPartidaMinutos = tiempoEnPartida / 60; // convierto el tiempo de la partida a minutos
    winrate = Number(((wins / partidasAnalizadas) * 100).toFixed(2)); // calculo el winrate del perfil y lo redondeo a 2 decimales
    kda = Number(((kills + assists) / divisor).toFixed(2)); // calculo el promedio de KDA del perfil y lo redondeo a 2 decimales
    csPorMinuto = Number((csTotal / tiempoEnPartidaMinutos).toFixed(2)); // calculo el promedio de CS por minuto del perfil y lo redondeo a 2 decimales
    oroPorMinuto = Number((oroTotal / tiempoEnPartidaMinutos).toFixed(2)); // calculo el promedio de oro por minuto del perfil y lo redondeo a 2 decimales
    dañoPorMinuto = Number((dañoTotal / tiempoEnPartidaMinutos).toFixed(2)); // calculo el promedio de daño por minuto del perfil y lo redondeo a 2 decimales
    visionPorMinuto = Number((visionTotal / tiempoEnPartidaMinutos).toFixed(2)); // calculo el promedio de vision por minuto del perfil y lo redondeo a 2 decimales
    score = Number();
  } catch (error) {
    console.error("Error al calcular las estadísticas finales: " + error);
  }
  return {
    winrate,
    kda,
    csPorMinuto,
    oroPorMinuto,
    dañoPorMinuto,
    visionPorMinuto,
    score,
  }; // devuelvo un objeto con las estadisticas calculadas
}

function calcularScores(todasLasStats) {
  const maxWinrate = Math.max(0.01, ...todasLasStats.map((s) => s.winrate));
  const maxKda = Math.max(0.01, ...todasLasStats.map((s) => s.kda));
  const maxCsPorMinuto = Math.max(
    0.01,
    ...todasLasStats.map((s) => s.csPorMinuto),
  );
  const maxOroPorMinuto = Math.max(
    0.01,
    ...todasLasStats.map((s) => s.oroPorMinuto),
  );
  const maxDañoPorMinuto = Math.max(
    0.01,
    ...todasLasStats.map((s) => s.dañoPorMinuto),
  );
  const maxVisionPorMinuto = Math.max(
    0.01,
    ...todasLasStats.map((s) => s.visionPorMinuto),
  );

  const scores = todasLasStats.map((stats) => {
    const score = Number(
      (
        ((stats.winrate / maxWinrate) * 0.4 +
          (stats.kda / maxKda) * 0.3 +
          (stats.csPorMinuto / maxCsPorMinuto) * 0.1 +
          (stats.oroPorMinuto / maxOroPorMinuto) * 0.1 +
          (stats.dañoPorMinuto / maxDañoPorMinuto) * 0.05 +
          (stats.visionPorMinuto / maxVisionPorMinuto) * 0.05) *
        100
      ).toFixed(2),
    ); // calculo el score del jugador y lo redondeo a 2 decimales

    return score;
  });

  return scores;
}

function crearPartida(jugador) {
  const li = document.createElement("li");
  li.classList.add("partida");
  li.dataset.resultado = jugador.win ? "victoria" : "derrota";

  const resultado = document.createElement("span");
  resultado.classList.add("partida__resultado");
  resultado.textContent = jugador.win ? "V" : "D";
  li.appendChild(resultado);

  const campeon = document.createElement("img"); // meto la imagen del campeon que jugo el invocador(añadiendo a la url el nombre del champ)
  campeon.classList.add("partida__campeon");
  campeon.src = URL_CAMPEON_POR_NOMBRE + jugador.championName + ".png";
  campeon.alt = jugador.championName;
  campeon.width = 48;
  campeon.height = 48;
  li.appendChild(campeon);

  const info = document.createElement("div");
  info.classList.add("partida__info");

  const nombre = document.createElement("h3");
  nombre.classList.add("partida__nombre");
  nombre.textContent = jugador.invocatorName;
  info.appendChild(nombre);

  const meta = document.createElement("p");
  meta.classList.add("partida__meta");
  meta.textContent = jugador.championName + " " + jugador.role;
  info.appendChild(meta);

  li.appendChild(info);

  const stats = document.createElement("dl");
  stats.classList.add("partida__stats");

  const datosStats = [
    {
      etiqueta: "KDA",
      valor: jugador.kills + "/" + jugador.deaths + "/" + jugador.assists,
    },
    { etiqueta: "CS", valor: jugador.totalMinionsKilled }, // cantidad de minions matados
    { etiqueta: "Oro", valor: jugador.goldEarned },
    {
      etiqueta: "Duración",
      valor: Math.round(jugador.timePlayed / 60) + " min",
    }, // transformo los segundos en minutos
  ];

  datosStats.forEach(function (stat) {
    const contenedor = document.createElement("div");
    contenedor.classList.add("partida__stat");

    const dt = document.createElement("dt");
    dt.textContent = stat.etiqueta;
    contenedor.appendChild(dt);

    const dd = document.createElement("dd");
    dd.textContent = stat.valor;
    contenedor.appendChild(dd);

    stats.appendChild(contenedor);
  });

  li.appendChild(stats);

  return li;
}

function mostrarPartidas(partidas) {
  const lista = document.querySelector("#listaPartidas");
  lista.innerHTML = "";

  partidas.forEach(function (partida, indice) {
    const listaPartida = document.createElement("li");
    listaPartida.classList.add("partida-grupo");

    // titulo de la partida: "Partida Numero 1", "Partida Numero 2", etc.
    const titulo = document.createElement("h3");
    titulo.classList.add("partida-grupo__titulo");
    titulo.textContent = "Partida Número " + (indice + 1);
    listaPartida.appendChild(titulo);

    //lista interna con los 10 jugadores
    const jugadores = document.createElement("ul");
    jugadores.classList.add("partida-jugadores");

    partida.forEach(function (jugador) {
      jugadores.appendChild(crearPartida(jugador));
    });

    listaPartida.appendChild(jugadores);
    lista.appendChild(listaPartida);
  });
}

async function Profile(account) {
  // renderizo el perfil del invocador en el html
  const soloDuoTier = account.ranked[0].tier;
  const flexTier = account.ranked[1].tier;
  document.getElementById("nameInvocator").textContent =
    "Nombre: " + account.name; // muestrop el nombre del invocador
  document.getElementById("levelProfile").textContent =
    "Nivel: " + account.level; //muestro el lvl
  document.getElementById("soloTier").textContent = soloDuoTier; // muestro el tier y division de soloQ
  document.getElementById("soloTierIcon").src =
    `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${soloDuoTier.toLowerCase()}.png`;

  document.getElementById("flexTierIcon").src =
    `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${flexTier.toLowerCase()}.png`;
  document.getElementById("soloRank").textContent = account.ranked[0].rank; // muestro el tier y division de soloQ
  document.getElementById("soloLp").textContent =
    account.ranked[0].leaguePoints + " LP"; // muestro los LP de soloQ
  document.getElementById("soloWins").textContent = account.ranked[0].wins; // muestro las victorias de soloQ
  document.getElementById("soloLosses").textContent = account.ranked[0].losses; // muestro las perdidas de soloQ

  document.getElementById("flexTier").textContent = flexTier; // muestro el tier y division de flexQ
  document.getElementById("flexRank").textContent = account.ranked[1].rank; // muestro el tier y division de flexQ
  document.getElementById("flexLp").textContent =
    account.ranked[1].leaguePoints + " LP"; // muestro los LP de flexQ

  document.getElementById("flexWins").textContent = account.ranked[1].wins; // muestro las victorias de flexQ
  document.getElementById("flexLosses").textContent = account.ranked[1].losses; // muestro las perdidas de flexQ
}

function llenarTabla(perfiles) {
  // calculo las stats de todos los jugadores
  const todasLasStats = [];
  for (let i = 0; i < perfiles.length; i++) {
    todasLasStats.push(calcularStats(perfiles[i]));
  }
  const scores = calcularScores(todasLasStats);
  for (let i = 0; i < perfiles.length; i++) {
    todasLasStats[i].score = scores[i]; // agrego el score al objeto de stats del jugador
  }

  // escribo en la tabla jugador x jugador
  for (let i = 0; i < perfiles.length; i++) {
    const perfil = perfiles[i];
    const stats = todasLasStats[i];
    // stats
    for (const key in stats) {
      let valor = stats[key]; // copia

      if (key === "winrate") {
        valor += "%"; // el %  se agrega a la copia
      }
      document.querySelector(
        `[data-jugador="${1 + i}"][data-estadistica="${key}"]`,
      ).textContent = valor;
    }

    //#region Rango del invocador

    const soloDuo = perfil.ranked.find(
      (entrada) => entrada.queueType === "RANKED_SOLO_5x5",
    );

    let textoRango;
    if (soloDuo === undefined) {
      textoRango = "Jugador Sin Rango";
    } else {
      textoRango = soloDuo.tier + " " + soloDuo.rank;
    }

    document.querySelector(
      `[data-jugador="${1 + i}"][data-estadistica="rango"]`,
    ).textContent = textoRango;

    //#endregion

    //#region Nombre del invocador

    document.getElementById(`comparativaJugador${1 + i}`).textContent =
      perfil.name;

    //#endregion
  }
}

const botonBuscar = document.getElementById("botonBuscar");
botonBuscar.addEventListener("click", async () => {
  botonBuscar.disabled = true;
  botonBuscar.textContent = "Buscando...";
  botonBuscar.style.cursor = "not-allowed"; // cambio el cursor del boton a no permitido
  botonBuscar.style.backgroundColor = "#6c757d"; // cambio el color del boton a gris
  try {
    const jugadores = leerJugadores();
    if (jugadores.length === 0) {
      alert("Por favor, ingresa al menos un invocador.");
      botonBuscar.disabled = false;
      botonBuscar.textContent = "Buscar";
      botonBuscar.style.cursor = ""; // restablezco el cursor del boton
      botonBuscar.style.backgroundColor = ""; // restablezco el color del boton
      return;
    }
    const perfiles = [];
    for (const jugador of jugadores) {
      const perfil = await getProfile(jugador.nombre, jugador.tag);
      perfiles.push(perfil);
    }
    llenarTabla(perfiles); // le paso a la funcion llenarTabla el array de objetos que contiene los datos de los invocadores para mostrarlo en el html

    Profile(perfiles[0]); // le paso a la funcion Profile el objeto que contiene los datos del invocador para mostrarlo en el html
    mostrarPartidas(perfiles[0].curedMatchHistory); // le paso a la funcion mostrarPartidas el objeto que contiene los datos del invocador para mostrarlo en el html
  } catch (error) {
    console.error("Error al obtener el perfil:", error);
    alert(
      "Ocurrió un error al obtener el perfil. Por favor, inténtalo de nuevo.",
    );
  }
  setTimeout(() => {
    botonBuscar.disabled = false;
    botonBuscar.textContent = "Buscar";
    botonBuscar.style.cursor = ""; // restablezco el cursor del boton
    botonBuscar.style.backgroundColor = ""; // restablezco el color del boton
  }, 15000); // habilito el boton despues de 15 segundos
});
