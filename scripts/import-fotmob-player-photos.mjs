import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const WORLD_CUP_URL = "https://www.fotmob.com/es/leagues/77/overview/world-cup";
const PHOTO_DIR = path.join(process.cwd(), "public", "player-photos", "fotmob");
const PHOTO_MODULE = path.join(process.cwd(), "src", "lib", "generated", "player-photos.ts");
const forceDownload = process.argv.includes("--force");

const fotmobTeamNamesById = {
  alg: "Algeria",
  arg: "Argentina",
  aus: "Australia",
  aut: "Austria",
  bel: "Belgium",
  bih: "Bosnia and Herzegovina",
  bra: "Brazil",
  can: "Canada",
  civ: "Ivory Coast",
  cod: "DR Congo",
  col: "Colombia",
  cpv: "Cape Verde",
  cro: "Croatia",
  cuw: "Curacao",
  cze: "Czechia",
  ecu: "Ecuador",
  egy: "Egypt",
  eng: "England",
  esp: "Spain",
  fra: "France",
  ger: "Germany",
  gha: "Ghana",
  hai: "Haiti",
  irn: "Iran",
  irq: "Iraq",
  jor: "Jordan",
  jpn: "Japan",
  kor: "South Korea",
  ksa: "Saudi Arabia",
  mar: "Morocco",
  mex: "Mexico",
  ned: "Netherlands",
  nor: "Norway",
  nzl: "New Zealand",
  pan: "Panama",
  par: "Paraguay",
  por: "Portugal",
  qat: "Qatar",
  rsa: "South Africa",
  sco: "Scotland",
  sen: "Senegal",
  sui: "Switzerland",
  swe: "Sweden",
  tun: "Tunisia",
  tur: "Turkiye",
  uru: "Uruguay",
  usa: "USA",
  uzb: "Uzbekistan",
};

function loadLegacyData() {
  const context = { window: {} };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(process.cwd(), "data.js"), "utf8");
  vm.runInContext(source, context, { filename: "data.js" });
  return context.window.PORRA_DATA;
}

function slug(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function playerNumber(playerId) {
  const match = playerId.match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function normalizeName(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function nameTokens(value) {
  return normalizeName(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token === "jr" ? "junior" : token));
}

function editDistance(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }

  return matrix[a.length][b.length];
}

function tokenMatch(playerToken, fotmobToken) {
  if (playerToken === fotmobToken) return true;
  if (playerToken.length >= 4 && fotmobToken.includes(playerToken)) return true;
  if (playerToken.length >= 5 && editDistance(playerToken, fotmobToken) <= 1) return true;
  return false;
}

function initialsAndSurnameMatch(playerName, fotmobName) {
  const playerTokens = nameTokens(playerName);
  const fotmobTokens = nameTokens(fotmobName);

  if (!playerTokens.length || !fotmobTokens.length) return false;

  return playerTokens.every((token, index) => {
    if (token.length === 1) return Boolean(fotmobTokens[index]?.startsWith(token));
    return fotmobTokens.some((fotmobToken) => tokenMatch(token, fotmobToken));
  });
}

function nameMatch(playerName, fotmobName) {
  const player = normalizeName(playerName);
  const fotmob = normalizeName(fotmobName);
  const compactPlayer = player.replace(/\s+/g, "");
  const compactFotmob = fotmob.replace(/\s+/g, "");

  if (!player || !fotmob) return false;
  if (fotmob.includes(player) || player.includes(fotmob)) return true;
  if (compactFotmob.includes(compactPlayer) || compactPlayer.includes(compactFotmob)) return true;

  if (initialsAndSurnameMatch(playerName, fotmobName)) return true;

  const playerTokens = nameTokens(playerName);
  const hasInitial = playerTokens.some((token) => token.length === 1);
  if (hasInitial) {
    const restCompact = playerTokens.filter((token) => token.length > 1).join("");
    if (fotmobTokensStartWithInitial(playerTokens, fotmobName) && restCompact && compactFotmob.includes(restCompact)) {
      return true;
    }
  }

  const playerLongTokens = playerTokens.filter((token) => token.length > 1);
  const fotmobTokens = nameTokens(fotmobName);
  if (!hasInitial && playerLongTokens.length && playerLongTokens.every((token) => fotmobTokens.some((fotmobToken) => tokenMatch(token, fotmobToken)))) return true;

  return false;
}

function fotmobTokensStartWithInitial(playerTokens, fotmobName) {
  const firstInitial = playerTokens.find((token) => token.length === 1);
  const [firstFotmobToken] = nameTokens(fotmobName);
  return Boolean(firstInitial && firstFotmobToken?.startsWith(firstInitial));
}

function findFotmobMember(player, membersByShirtNumber, members) {
  const numberCandidates = membersByShirtNumber.get(playerNumber(player.id)) || [];
  if (numberCandidates.length === 1) return numberCandidates[0];

  if (numberCandidates.length > 1) {
    const numberNameMatches = numberCandidates.filter((member) => nameMatch(player.name, member.name));
    if (numberNameMatches.length === 1) return numberNameMatches[0];
  }

  const matches = members.filter((member) => nameMatch(player.name, member.name));
  return matches.length === 1 ? matches[0] : null;
}

function playersByTeam(players) {
  const grouped = new Map();
  players.forEach((player) => {
    const teamPlayers = grouped.get(player.team) || [];
    teamPlayers.push(player);
    grouped.set(player.team, teamPlayers);
  });
  return grouped;
}

function extractNextData(html) {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("Could not find FotMob __NEXT_DATA__");

  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf("</script>", jsonStart);
  if (jsonEnd === -1) throw new Error("Could not close FotMob __NEXT_DATA__");

  return JSON.parse(html.slice(jsonStart, jsonEnd));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return response.text();
}

async function downloadFile(url, target) {
  const existedBefore = fs.existsSync(target);
  if (existedBefore && !forceDownload) return { ok: true, downloaded: false };

  const response = await fetch(url, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*",
      "user-agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, buffer);
  return { ok: true, downloaded: !existedBefore || forceDownload };
}

function findLeagueTeams(leagueData) {
  const teams = leagueData.props.pageProps.fixtures?.fixtureInfo?.teams || [];
  return new Map(teams.map((team) => [team.name, team]));
}

function findSquadMembers(teamData, fotmobTeamId) {
  const fallback = teamData.props.pageProps.fallback?.[`team-${fotmobTeamId}`];
  const squadGroups = fallback?.squad?.squad || fallback?.overview?.squad || [];

  return squadGroups
    .filter((group) => group.title !== "coach")
    .flatMap((group) => group.members || [])
    .filter((member) => member.id && member.shirtNumber);
}

function writePhotoModule(photoMap) {
  const sortedEntries = Object.entries(photoMap).sort(([a], [b]) => a.localeCompare(b));
  const objectLiteral = Object.fromEntries(sortedEntries);
  const body = `export const playerPhotoOverrides: Record<string, string> = ${JSON.stringify(
    objectLiteral,
    null,
    2,
  )};\n`;

  fs.mkdirSync(path.dirname(PHOTO_MODULE), { recursive: true });
  fs.writeFileSync(PHOTO_MODULE, body);
}

function pruneUnusedPhotos(photoMap) {
  const mappedFiles = new Set(Object.values(photoMap).map((photoPath) => path.basename(photoPath)));

  fs.readdirSync(PHOTO_DIR)
    .filter((fileName) => fileName.endsWith(".png") && !mappedFiles.has(fileName))
    .forEach((fileName) => {
      fs.unlinkSync(path.join(PHOTO_DIR, fileName));
    });
}

async function main() {
  const data = loadLegacyData();
  const leagueData = extractNextData(await fetchText(WORLD_CUP_URL));
  const fotmobTeamsByName = findLeagueTeams(leagueData);

  fs.mkdirSync(PHOTO_DIR, { recursive: true });

  const photoMap = {};
  const misses = [];
  let downloaded = 0;
  let reused = 0;

  for (const [teamId, players] of playersByTeam(data.players).entries()) {
    const fotmobName = fotmobTeamNamesById[teamId];
    const fotmobTeam = fotmobName ? fotmobTeamsByName.get(fotmobName) : null;

    if (!fotmobTeam?.id) {
      misses.push({ teamId, reason: "FotMob team not found" });
      continue;
    }

    const teamUrl = `https://www.fotmob.com/es/teams/${fotmobTeam.id}/squad/${slug(fotmobName)}`;
    const teamData = extractNextData(await fetchText(teamUrl));
    const members = findSquadMembers(teamData, fotmobTeam.id);
    const membersByShirtNumber = new Map();
    members.forEach((member) => {
      const shirtNumber = Number(member.shirtNumber);
      const numberMembers = membersByShirtNumber.get(shirtNumber) || [];
      numberMembers.push(member);
      membersByShirtNumber.set(shirtNumber, numberMembers);
    });

    for (const player of players) {
      const member = findFotmobMember(player, membersByShirtNumber, members);

      if (!member) {
        misses.push({ playerId: player.id, name: player.name, reason: "FotMob player not found" });
        continue;
      }

      const fileName = `${player.id}.png`;
      const target = path.join(PHOTO_DIR, fileName);
      const imageUrl = `https://images.fotmob.com/image_resources/playerimages/${member.id}.png`;
      const result = await downloadFile(imageUrl, target);

      if (!result.ok) {
        misses.push({
          playerId: player.id,
          name: player.name,
          fotmobId: member.id,
          reason: result.error || "photo download failed",
        });
        continue;
      }

      if (result.downloaded) downloaded += 1;
      else reused += 1;

      photoMap[player.id] = `/player-photos/fotmob/${fileName}`;
    }
  }

  writePhotoModule(photoMap);
  pruneUnusedPhotos(photoMap);

  console.log(`FotMob photos mapped: ${Object.keys(photoMap).length}`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Already present: ${reused}`);

  if (misses.length) {
    console.log(`Missing: ${misses.length}`);
    console.log(JSON.stringify(misses, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
