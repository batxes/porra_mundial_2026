(function () {
  "use strict";

  const data = window.PORRA_DATA;
  const schedule = (window.PORRA_SCHEDULE || []).map(([number, date, time, home, away, venue, stage]) => ({
    number,
    date,
    time,
    home,
    away,
    venue,
    stage,
  }));
  const config = window.PORRA_CONFIG || {};
  const teams = new Map(data.teams.map((team) => [team.id, team]));
  const players = new Map(data.players.map((player) => [player.id, player]));
  const knockoutMatches = schedule.filter((match) => match.number >= 73);
  const scoring = window.PORRA_SCORING.createEngine({ data, schedule });
  const knockoutStages = ["Dieciseisavos", "Octavos", "Cuartos", "Semifinales", "Tercer puesto", "Final"];
  const sections = [
    { id: "groups", label: "1. Grupos" },
    { id: "knockout", label: "2. Eliminatorias" },
    { id: "results", label: "3. Marcadores" },
    { id: "extras", label: "4. Extras" },
    { id: "xi", label: "5. Tu once" },
  ];
  const xiLimits = { POR: 1, DEF: 4, MED: 4, DEL: 2 };
  const xiLabels = { POR: "Porteros", DEF: "Defensas", MED: "Mediocampistas", DEL: "Delanteros" };
  const defaultAdminEmail = "admin@admin.admin";
  const defaultAdminPasswordHash = "3812b8873bd75366c1fc7c4141c6f9ca5778067968883eaf9c4e0265582b7a1f";
  const avatarPresets = [
    { id: "green", label: "26" },
    { id: "gold", label: "TR" },
    { id: "blue", label: "FC" },
    { id: "rose", label: "XI" },
    { id: "dark", label: "GO" },
  ];
  const localKeys = {
    users: "porra26_users",
    currentEmail: "porra26_current_email",
    predictions: "porra26_predictions",
    adminMatches: "porra26_admin_matches",
  };
  const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
  const supabase = hasSupabaseConfig
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;

  const state = {
    route: window.location.hash.replace("#", "") || "inicio",
    section: "groups",
    user: null,
    prediction: emptyPrediction(),
    authMode: "register",
    authBusy: false,
    communityPlayers: [],
    validatedMatches: [],
    validatedEvents: [],
    scoreEntries: [],
  };

  const app = document.querySelector("#app");
  const authDialog = document.querySelector("#auth-dialog");
  const publicProfileDialog = document.querySelector("#public-profile-dialog");
  const scoreChartDialog = document.querySelector("#score-chart-dialog");

  function emptyPrediction() {
    const groups = {};
    data.teams.forEach((team) => {
      groups[team.group] ||= {};
      groups[team.group][team.id] = "";
    });

    return {
      groups,
      bracket: { thirdQualifiers: [], thirdSlots: {}, winners: {} },
      matchPredictions: {},
      extras: {
        highestScoringTeam: "",
        topScorer: "",
        mostConcededTeam: "",
        mostRedsTeam: "",
        fewestRedsTeam: "",
        mvp: "",
      },
      xi: [],
      isDefinitive: false,
      updatedAt: null,
    };
  }

  function ensurePredictionState() {
    state.prediction = normalizePrediction(state.prediction);
    if (!sections.some((section) => section.id === state.section)) state.section = "groups";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  function flagUrl(team) {
    return `https://flagcdn.com/w40/${team.code}.png`;
  }

  function flag(teamId) {
    const team = teams.get(teamId);
    return team
      ? `<img class="flag" src="${flagUrl(team)}" alt="Bandera de ${escapeHtml(team.name)}" loading="lazy" />`
      : "";
  }

  function teamLabel(teamId) {
    const team = teams.get(teamId);
    return team ? `${flag(team.id)}<span>${escapeHtml(team.name)}</span>` : "<span>Sin elegir</span>";
  }

  function teamOptions(selected = "", placeholder = "Elige un equipo") {
    return [
      `<option value="">${placeholder}</option>`,
      ...data.teams.map(
        (team) =>
          `<option value="${team.id}" ${selected === team.id ? "selected" : ""}>${escapeHtml(team.name)}</option>`,
      ),
    ].join("");
  }

  function playerOptions(selected = "", placeholder = "Elige un jugador") {
    return [
      `<option value="">${placeholder}</option>`,
      ...data.players.map((player) => {
        const team = teams.get(player.team);
        return `<option value="${player.id}" ${selected === player.id ? "selected" : ""}>${escapeHtml(player.name)} · ${escapeHtml(team.name)}</option>`;
      }),
    ].join("");
  }

  function getLocalJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function setLocalJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function currentAdminResults() {
    if (!supabase) return getLocalJson(localKeys.adminMatches, {});
    const results = {};
    state.validatedMatches.forEach((match) => {
      const number = String(match.id || "").replace("wc26-", "");
      if (!number) return;
      results[number] = {
        homeScore: match.home_score,
        awayScore: match.away_score,
        homeTeamId: match.home_team_id,
        awayTeamId: match.away_team_id,
        events: [],
      };
    });
    state.validatedEvents.forEach((event) => {
      const number = String(event.match_id || "").replace("wc26-", "");
      if (!number) return;
      results[number] ||= { homeScore: "", awayScore: "", events: [] };
      results[number].events ||= [];
      results[number].events.push({
        id: event.id,
        supabaseId: event.id,
        playerId: event.player_id,
        teamId: event.team_id,
        type: event.event_type,
        minute: event.minute,
      });
    });
    return results;
  }

  function scorecardForUser(userId, prediction) {
    if (supabase) return scoring.scorecardFromEntries(state.scoreEntries.filter((entry) => entry.user_id === userId));
    return scoring.calculateScorecard(normalizePrediction(prediction), currentAdminResults(), userId);
  }

  function currentUserScorecard() {
    if (!state.user) return scoring.scorecardFromEntries([]);
    return scorecardForUser(state.user.id, state.prediction);
  }

  function participantCount() {
    if (supabase) return state.communityPlayers.length;
    return getLocalJson(localKeys.users, []).filter(
      (user) => user.email !== defaultAdminEmail || user.id === state.user?.id,
    ).length;
  }

  async function digest(value) {
    const bytes = new TextEncoder().encode(value);
    const buffer = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function ensureLocalAdminUser() {
    if (supabase) return;
    const users = getLocalJson(localKeys.users, []);
    const adminEmail = defaultAdminEmail;
    const admin = users.find((user) => user.email === adminEmail);
    if (admin) {
      admin.name = "admin";
      admin.passwordHash = defaultAdminPasswordHash;
      admin.isAdmin = true;
      setLocalJson(localKeys.users, users);
      return;
    }
    users.unshift({
      id: "local-admin",
      name: "admin",
      email: adminEmail,
      passwordHash: defaultAdminPasswordHash,
      points: 0,
      isAdmin: true,
      avatarUrl: "preset:gold",
    });
    setLocalJson(localKeys.users, users);
  }

  function normalizePrediction(prediction) {
    const initial = emptyPrediction();
    return {
      ...initial,
      ...prediction,
      groups: { ...initial.groups, ...(prediction?.groups || {}) },
      bracket: {
        thirdQualifiers: prediction?.bracket?.thirdQualifiers || [],
        thirdSlots: prediction?.bracket?.thirdSlots || {},
        winners: prediction?.bracket?.winners || {},
      },
      matchPredictions: { ...(prediction?.matchPredictions || {}) },
      extras: { ...initial.extras, ...(prediction?.extras || {}) },
      xi: Array.isArray(prediction?.xi) ? prediction.xi : [],
    };
  }

  async function restoreSession() {
    if (supabase) {
      await loadSupabasePublicData();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) await loadSupabaseUser(session.user);
      supabase.auth.onAuthStateChange(async (_event, nextSession) => {
        if (nextSession?.user) await loadSupabaseUser(nextSession.user);
        else {
          state.user = null;
          state.prediction = emptyPrediction();
        }
        await loadSupabasePublicData();
        render();
      });
      return;
    }

    await ensureLocalAdminUser();
    const email = localStorage.getItem(localKeys.currentEmail);
    const users = getLocalJson(localKeys.users, []);
    const localUser = users.find((user) => user.email === email);
    if (localUser) {
      localUser.isAdmin = Boolean(localUser.isAdmin || config.adminEmails?.includes(localUser.email));
      setLocalJson(localKeys.users, users);
      state.user = localUser;
      const predictions = getLocalJson(localKeys.predictions, {});
      state.prediction = normalizePrediction(predictions[localUser.id]);
    }
  }

  async function loadSupabaseUser(authUser) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, total_points, is_admin")
      .eq("id", authUser.id)
      .maybeSingle();
    state.user = {
      id: authUser.id,
      email: authUser.email,
      name: profile?.display_name || authUser.user_metadata?.display_name || authUser.email.split("@")[0],
      avatarUrl: profile?.avatar_url || "",
      points: profile?.total_points || 0,
      isAdmin: Boolean(profile?.is_admin),
    };
    const { data: prediction } = await supabase
      .from("predictions")
      .select("selections, is_definitive, updated_at")
      .eq("user_id", authUser.id)
      .maybeSingle();
    state.prediction = normalizePrediction(prediction?.selections);
    state.prediction.isDefinitive = Boolean(prediction?.is_definitive || state.prediction.isDefinitive);
    state.prediction.updatedAt = prediction?.updated_at || null;
  }

  async function loadSupabasePublicData() {
    const [{ data: profiles }, { data: predictions }, { data: matches }, { data: events }, { data: scoreEntries }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, avatar_url, total_points, is_admin"),
      supabase.from("predictions").select("user_id, selections, completion_percent, is_definitive"),
      supabase
        .from("matches")
        .select("id, stage, scheduled_at, home_team_id, away_team_id, home_score, away_score")
        .order("scheduled_at", { ascending: false }),
      supabase.from("match_events").select("id, match_id, event_type, player_id, team_id, minute"),
      supabase.from("score_entries").select("user_id, match_id, rule_code, points, explanation, source_ref, created_at"),
    ]);
    const predictionByUser = new Map((predictions || []).map((prediction) => [prediction.user_id, prediction]));
    state.scoreEntries = scoreEntries || [];
    state.communityPlayers = (profiles || []).map((profile) => {
      const prediction = predictionByUser.get(profile.id);
      const scorecard = scoring.scorecardFromEntries(state.scoreEntries.filter((entry) => entry.user_id === profile.id));
      return {
        id: profile.id,
        name: profile.display_name,
        avatarUrl: profile.avatar_url || "",
        initials: initials(profile.display_name),
        points: scorecard.entries.length ? scorecard.total : profile.total_points || 0,
        complete: prediction?.completion_percent || 0,
        champion: prediction?.selections?.bracket?.winners?.["104"] || "",
        prediction: prediction?.selections ? normalizePrediction(prediction.selections) : null,
        scorecard,
        isAdmin: Boolean(profile.is_admin),
      };
    });
    state.validatedMatches = matches || [];
    state.validatedEvents = events || [];
    if (state.user) {
      const current = state.communityPlayers.find((player) => player.id === state.user.id);
      if (current) state.user.points = current.points;
    }
  }

  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function avatarPreset(avatarUrl) {
    const presetId = String(avatarUrl || "").replace("preset:", "");
    return avatarPresets.find((preset) => preset.id === presetId) || null;
  }

  function renderAvatar(user, extraClass = "") {
    const name = typeof user === "string" ? user : user?.name;
    const avatarUrl = typeof user === "object" ? user?.avatarUrl : "";
    if (avatarUrl && !avatarUrl.startsWith("preset:")) {
      return `<span class="avatar avatar-photo ${extraClass}" style="background-image:url('${escapeAttr(avatarUrl)}')"></span>`;
    }
    const preset = avatarPreset(avatarUrl);
    const className = preset ? `avatar-${preset.id}` : "";
    return `<span class="avatar ${className} ${extraClass}">${escapeHtml(preset?.label || initials(name))}</span>`;
  }

  function applyAvatarElement(element, user) {
    const avatarUrl = user?.avatarUrl || "";
    element.className = "avatar";
    element.style.backgroundImage = "";
    if (avatarUrl && !avatarUrl.startsWith("preset:")) {
      element.classList.add("avatar-photo");
      element.style.backgroundImage = `url("${avatarUrl.replace(/"/g, "%22")}")`;
      element.textContent = "";
      return;
    }
    const preset = avatarPreset(avatarUrl);
    if (preset) element.classList.add(`avatar-${preset.id}`);
    element.textContent = preset?.label || initials(user?.name);
  }

  function updateHeader() {
    const name = document.querySelector("#header-name");
    const points = document.querySelector("#header-points");
    const avatar = document.querySelector("#header-avatar");
    document.querySelector("#admin-link").hidden = !state.user?.isAdmin;
    if (state.user) {
      const scorecard = currentUserScorecard();
      state.user.points = scorecard.total;
      name.textContent = state.user.name;
      points.textContent = `${scorecard.total} puntos`;
      applyAvatarElement(avatar, state.user);
    } else {
      name.textContent = "Entrar";
      points.textContent = "Crea tu cuenta";
      avatar.className = "avatar";
      avatar.style.backgroundImage = "";
      avatar.textContent = "?";
    }

    document.querySelectorAll(".main-nav a").forEach((link) => {
      link.classList.toggle("active", link.dataset.route === state.route);
    });
  }

  function go(route) {
    state.route = route || "inicio";
    const nextHash = `#${state.route}`;
    if (window.location.hash === nextHash) {
      window.scrollTo({ top: 0, behavior: "auto" });
      render();
      return;
    }
    window.location.hash = state.route;
  }

  function render() {
    ensurePredictionState();
    updateHeader();
    const renderers = {
      inicio: renderHome,
      "como-funciona": renderHowItWorks,
      porra: renderPrediction,
      partidos: renderMatches,
      clasificacion: renderLeaderboard,
      perfil: renderProfile,
      admin: renderAdmin,
    };
    app.innerHTML = (renderers[state.route] || renderHome)();
    app.focus({ preventScroll: true });
  }

  function renderHome() {
    const completion = calculateCompletion();
    return `
      <div class="page-shell">
        <section class="hero">
          <img class="hero-banner-image" src="./assets/triliporra-banner.png" alt="TRILIPORRA, banner del Mundial con jugadores disputando un balón y un capitán levantando la Copa del Mundo" />
          <div class="hero-content">
            <p class="sr-only">Canadá, México y Estados Unidos. TRILIPORRA. Tu Mundial empieza antes del primer silbato.</p>
            <div class="hero-actions">
              <button class="button button-primary" data-go="porra" type="button">
                ${state.user ? "Continuar mi porra" : "Crear mi porra"}
              </button>
              <button class="button button-secondary" data-go="como-funciona" type="button">Cómo funciona</button>
              <button class="button button-secondary" data-go="clasificacion" type="button">Ver clasificación</button>
            </div>
          </div>
        </section>

        <section class="stats-strip" aria-label="Datos del torneo">
          <article class="stat-card"><span>Selecciones</span><strong>48</strong><small>12 grupos</small></article>
          <article class="stat-card"><span>Partidos</span><strong>104</strong><small>Del 11 jun. al 19 jul.</small></article>
          <article class="stat-card"><span>Participantes</span><strong>${participantCount()}</strong><small>En esta porra</small></article>
          <article class="stat-card"><span>Tu porra</span><strong>${completion}%</strong><small>Completada</small></article>
        </section>

        <section class="dashboard-grid">
          <article class="card">
            <p class="eyebrow">Antes del 11 de junio</p>
            <h3>${state.user ? "Termina tu pronóstico" : "Entra, decide y disfruta el Mundial"}</h3>
            <p class="muted">Tu porra se puede editar hasta el inicio del torneo. Después quedará visible para el resto de participantes.</p>
            <div class="progress-label"><span>Progreso</span><strong>${completion}%</strong></div>
            <div class="progress"><span style="width:${completion}%"></span></div>
            <div class="button-row">
              <button class="button button-dark" data-go="porra" type="button">${completion ? "Seguir completando" : "Empezar ahora"}</button>
            </div>
          </article>
          <article class="card">
            <p class="eyebrow">Sistema de puntos</p>
            <h3>Cada detalle cuenta</h3>
            <div class="rule-grid">
              ${data.pointsRules
                .slice(0, 5)
                .map((rule) => `<div class="rule"><span>${escapeHtml(rule.label)}</span><strong>${rule.value}</strong></div>`)
                .join("")}
            </div>
          </article>
        </section>
      </div>
    `;
  }

  function renderHeroArt() {
    return `
      <svg class="hero-scene" viewBox="0 0 560 420" role="img" aria-label="Escena de fútbol con jugadores y copa estilizada">
        <defs>
          <linearGradient id="sky-glow" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stop-color="#fff8c7" />
            <stop offset="0.48" stop-color="#6ac76c" />
            <stop offset="1" stop-color="#236f37" />
          </linearGradient>
          <linearGradient id="field-glow" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="#1f6b35" />
            <stop offset="0.5" stop-color="#4caf50" />
            <stop offset="1" stop-color="#19562d" />
          </linearGradient>
          <linearGradient id="trophy-gold" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stop-color="#fff3a4" />
            <stop offset="0.48" stop-color="#ffdd44" />
            <stop offset="1" stop-color="#d9a51f" />
          </linearGradient>
        </defs>
        <rect width="560" height="420" rx="38" fill="url(#sky-glow)" />
        <circle cx="444" cy="70" r="62" fill="rgba(255,221,68,.42)" />
        <path d="M0 294c116-50 233-60 352-31 84 20 148 19 208-2v159H0Z" fill="url(#field-glow)" />
        <path d="M30 353c126-30 258-35 398-10" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="4" />
        <path d="M272 263c-34 24-57 59-69 104" fill="none" stroke="rgba(255,255,255,.32)" stroke-width="3" />
        <ellipse cx="280" cy="364" rx="106" ry="34" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="4" />

        <g class="scene-player scene-player-left">
          <circle cx="146" cy="166" r="23" fill="#f3c28b" />
          <path d="M119 204c26-23 62-24 88 1l-16 72h-55Z" fill="#ffffff" />
          <path d="M135 230l-60 33" stroke="#fff" stroke-width="16" stroke-linecap="round" />
          <path d="M192 226l47 39" stroke="#fff" stroke-width="16" stroke-linecap="round" />
          <path d="M143 275l-27 72" stroke="#172a20" stroke-width="18" stroke-linecap="round" />
          <path d="M181 276l47 64" stroke="#172a20" stroke-width="18" stroke-linecap="round" />
          <path d="M132 201c18 14 42 15 62 0" fill="none" stroke="#4caf50" stroke-width="9" />
        </g>

        <g class="scene-player scene-player-right">
          <circle cx="334" cy="150" r="22" fill="#8f5a38" />
          <path d="M303 192c25-24 63-24 88 1l-18 78h-54Z" fill="#ffdd44" />
          <path d="M319 219l-58 44" stroke="#ffdd44" stroke-width="16" stroke-linecap="round" />
          <path d="M374 216l48 31" stroke="#ffdd44" stroke-width="16" stroke-linecap="round" />
          <path d="M323 270l-58 58" stroke="#1f3327" stroke-width="18" stroke-linecap="round" />
          <path d="M362 270l25 76" stroke="#1f3327" stroke-width="18" stroke-linecap="round" />
          <path d="M320 190c18 12 39 12 57 0" fill="none" stroke="#2f7d32" stroke-width="9" />
        </g>

        <g class="scene-ball">
          <circle cx="258" cy="286" r="24" fill="#fff" />
          <path d="M258 264l14 10-5 17h-18l-6-17Z" fill="#1f3327" />
          <path d="M237 286h20m22-3-14 11m-14 13 6-16" stroke="#1f3327" stroke-width="3" />
        </g>

        <g class="scene-trophy">
          <path d="M414 79h75c-3 37-18 61-37 70-21-9-35-33-38-70Z" fill="url(#trophy-gold)" />
          <path d="M418 91c-24 2-38 18-34 36 4 17 20 28 44 27" fill="none" stroke="#ffdd44" stroke-width="10" stroke-linecap="round" />
          <path d="M485 91c24 2 38 18 34 36-4 17-20 28-44 27" fill="none" stroke="#ffdd44" stroke-width="10" stroke-linecap="round" />
          <path d="M440 150h24l7 44h-38Z" fill="#ffdd44" />
          <path d="M413 198h78l13 24H400Z" fill="#ffdd44" />
          <path d="M397 72c17-21 42-31 70-27 18 3 34 11 48 26" fill="none" stroke="rgba(255,255,255,.65)" stroke-width="5" stroke-linecap="round" />
        </g>
      </svg>
    `;
  }

  function renderHowItWorks() {
    return `
      <div class="page-shell">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Reglas claras</p>
            <h1>Cómo funciona</h1>
            <p class="muted">Rellena tu porra antes de que empiece cada plazo. Los puntos se recalculan cada vez que el admin valida o corrige datos.</p>
          </div>
        </div>
        <section class="info-grid how-grid">
          <article class="card">
            <h3>Qué tienes que rellenar</h3>
            <div class="summary-list">
              <div class="summary-item"><span>Grupos</span><strong>Posiciones 1º a 4º</strong></div>
              <div class="summary-item"><span>Eliminatorias</span><strong>Ganador de cada cruce</strong></div>
              <div class="summary-item"><span>Marcadores</span><strong>Resultado de cada partido visible</strong></div>
              <div class="summary-item"><span>Extras</span><strong>Goleadores, MVP y equipos destacados</strong></div>
              <div class="summary-item"><span>Tu once</span><strong>1 POR, 4 DEF, 4 MED, 2 DEL</strong></div>
            </div>
          </article>
          <article class="card">
            <h3>Cuándo se bloquea</h3>
            <p class="muted">La porra completa puede guardarse como borrador o hacerse definitiva. Los marcadores de partidos concretos se pueden cambiar hasta que empiece ese partido.</p>
            <p class="muted">Cuando los cruces de eliminatorias quedan resueltos en tu cuadro, aparecen sus partidos para que metas marcador.</p>
          </article>
          <article class="card">
            <h3>Puntos de partido</h3>
            <div class="rule-grid">
              <div class="rule"><span>Marcador exacto</span><strong>Goles del partido</strong></div>
              <div class="rule"><span>Gol de jugador de tu once</span><strong>+2</strong></div>
              <div class="rule"><span>Penalti marcado</span><strong>+1</strong></div>
              <div class="rule"><span>MVP del partido</span><strong>+3</strong></div>
              <div class="rule"><span>Penalti parado</span><strong>+2</strong></div>
              <div class="rule"><span>Penalti fallado</span><strong>-1</strong></div>
              <div class="rule"><span>Tarjeta roja</span><strong>-2</strong></div>
            </div>
          </article>
          <article class="card">
            <h3>Puntos de torneo</h3>
            <div class="rule-grid">
              <div class="rule"><span>Posición acertada en grupo cerrado</span><strong>+1</strong></div>
              <div class="rule"><span>Equipo que avanza en eliminatoria</span><strong>+1</strong></div>
              <div class="rule"><span>Campeón del Mundial</span><strong>+5</strong></div>
              <div class="rule"><span>MVP del Mundial</span><strong>+5</strong></div>
              <div class="rule"><span>Máximo goleador</span><strong>+5</strong></div>
            </div>
          </article>
        </section>
      </div>
    `;
  }

  function renderPrediction() {
    sanitizeBracket();
    return `
      <div class="page-shell">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Pronóstico editable hasta el 11 de junio</p>
            <h1>Mi porra</h1>
            <p class="muted">Completa cada apartado. Puedes guardar un borrador y volver cuando quieras.</p>
          </div>
          <strong>${calculateCompletion()}%</strong>
        </div>
        ${state.prediction.isDefinitive ? '<div class="notice">Esta porra es definitiva. Puedes consultarla, pero ya no se puede modificar.</div>' : ""}
        <div class="stepper">
          ${sections
            .map(
              (section) =>
                `<button class="${state.section === section.id ? "active" : ""}" data-section="${section.id}" type="button">${section.label}</button>`,
            )
            .join("")}
        </div>
        ${renderPredictionSection()}
        ${renderScoreBreakdown(currentUserScorecard(), "Tus puntos conseguidos")}
        <div class="action-bar">
          <p>${state.prediction.isDefinitive ? "Porra definitiva" : state.prediction.updatedAt ? "Borrador guardado" : "Tu borrador aún no está guardado"}</p>
          ${
            state.prediction.isDefinitive
              ? ""
              : '<span class="button-row"><button class="button" data-action="save-prediction" type="button">Guardar borrador</button><button class="button button-primary" data-action="finalize-prediction" type="button">Hacer definitiva</button></span>'
          }
        </div>
      </div>
    `;
  }

  function renderPredictionSection() {
    const renderers = {
      groups: renderGroups,
      knockout: renderKnockout,
      results: renderMatchPredictions,
      extras: renderExtras,
      xi: renderXi,
    };
    return renderers[state.section]();
  }

  function renderGroups() {
    const byGroup = data.teams.reduce((groups, team) => {
      groups[team.group] ||= [];
      groups[team.group].push(team);
      return groups;
    }, {});
    return `
      <div class="section-heading">
        <div>
          <p class="eyebrow">Fase de grupos</p>
          <h2>Ordena cada grupo</h2>
          <p class="muted">Arrastra cada selección para colocarla 1ª, 2ª, 3ª y 4ª. En móvil también puedes usar los botones de subir/bajar.</p>
        </div>
      </div>
      <div class="groups-grid">
        ${Object.entries(byGroup)
          .map(
            ([group, groupTeams]) => {
              const orderedTeams = orderedGroupTeams(group, groupTeams);
              return `
              <article class="group-card">
                <h3>Grupo ${group}</h3>
                <ol class="group-sort-list" data-group-list="${group}" aria-label="Orden del grupo ${group}">
                ${orderedTeams
                  .map(
                    (team, index) => `
                    <li class="group-sort-item" data-group="${group}" data-team="${team.id}" draggable="${state.prediction.isDefinitive ? "false" : "true"}">
                      <span class="group-position">${index + 1}º</span>
                      <span class="team-name">${teamLabel(team.id)}</span>
                      <span class="group-drag-handle" aria-hidden="true">⋮⋮</span>
                      <span class="group-sort-actions">
                        <button class="button button-mini" data-move-group-team="${group}" data-team="${team.id}" data-direction="-1" ${state.prediction.isDefinitive || index === 0 ? "disabled" : ""} type="button" aria-label="Subir ${escapeHtml(team.name)}">↑</button>
                        <button class="button button-mini" data-move-group-team="${group}" data-team="${team.id}" data-direction="1" ${state.prediction.isDefinitive || index === orderedTeams.length - 1 ? "disabled" : ""} type="button" aria-label="Bajar ${escapeHtml(team.name)}">↓</button>
                      </span>
                    </li>`,
                  )
                  .join("")}
                </ol>
              </article>`;
            },
          )
          .join("")}
      </div>
    `;
  }

  function orderedGroupTeams(group, fallbackTeams) {
    const positions = state.prediction.groups[group] || {};
    const rows = fallbackTeams.map((team, fallbackIndex) => ({
      team,
      fallbackIndex,
      position: Number(positions[team.id]) || fallbackIndex + 1,
    }));
    rows.sort((a, b) => a.position - b.position || a.fallbackIndex - b.fallbackIndex);
    return rows.map((row) => row.team);
  }

  function setGroupOrder(group, teamIds) {
    if (state.prediction.isDefinitive) return;
    state.prediction.groups[group] ||= {};
    teamIds.forEach((teamId, index) => {
      state.prediction.groups[group][teamId] = String(index + 1);
    });
    sanitizeBracket();
  }

  function moveGroupTeam(group, teamId, direction) {
    if (state.prediction.isDefinitive) return;
    const groupTeams = data.teams.filter((team) => team.group === group);
    const ordered = orderedGroupTeams(group, groupTeams).map((team) => team.id);
    const index = ordered.indexOf(teamId);
    const nextIndex = index + Number(direction);
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    const [moved] = ordered.splice(index, 1);
    ordered.splice(nextIndex, 0, moved);
    setGroupOrder(group, ordered);
  }

  function renderKnockout() {
    return `
      <div class="section-heading">
        <div>
          <p class="eyebrow">Cuadro general</p>
          <h2>Construye el camino a la final</h2>
          <p class="muted">Los primeros y segundos de tus grupos ya ocupan su casilla. Elige los ocho mejores terceros y después el ganador de cada partido.</p>
        </div>
      </div>
      <article class="stage-card">
        <div class="stage-heading">
          <h3>Ocho mejores terceros</h3>
          <span>${state.prediction.bracket.thirdQualifiers.length} / 8</span>
        </div>
        <div class="team-chip-grid">
          ${Object.keys(state.prediction.groups)
            .map((group) => {
              const teamId = groupTeamAt(group, 3);
              const selected = state.prediction.bracket.thirdQualifiers.includes(group);
              const disabled =
                state.prediction.isDefinitive ||
                !teamId ||
                (!selected && state.prediction.bracket.thirdQualifiers.length >= 8);
              return `
                <button class="pick-chip ${selected ? "selected" : ""}" data-third-group="${group}" ${disabled ? "disabled" : ""} type="button">
                  ${teamId ? flag(teamId) : ""}<span>3º grupo ${group}${teamId ? ` · ${escapeHtml(teams.get(teamId).name)}` : ""}</span>
                </button>`;
            })
            .join("")}
        </div>
        <p class="tiny muted">Cuando marques ocho grupos, las casillas variables se repartirán automáticamente entre los cruces compatibles publicados por FIFA.</p>
      </article>
      <div class="stage-stack">
        ${knockoutStages.map(renderKnockoutStage).join("")}
      </div>
    `;
  }

  function renderKnockoutStage(stage) {
    const matches = knockoutMatches.filter((match) => match.stage === stage);
    return `
      <article class="stage-card">
        <div class="stage-heading">
          <h3>${stage}</h3>
          <span>${matches.length} ${matches.length === 1 ? "partido" : "partidos"}</span>
        </div>
        <div class="bracket-grid">
          ${matches.map(renderBracketMatch).join("")}
        </div>
      </article>
    `;
  }

  function renderBracketMatch(match) {
    const home = resolveSlot(match.home, match.number);
    const away = resolveSlot(match.away, match.number);
    const winner = state.prediction.bracket.winners[String(match.number)] || "";
    return `
      <div class="bracket-match">
        <div class="fixture-meta"><strong>Partido ${match.number}</strong><span>${formatScheduleDate(match)}</span></div>
        <div class="bracket-team-row ${winner === home ? "selected" : ""}">
          ${renderBracketSlot(match.home, match.number, home)}
          <button class="winner-button" data-match-winner="${match.number}" data-team="${home || ""}" ${!home || state.prediction.isDefinitive ? "disabled" : ""} type="button">Pasa</button>
        </div>
        <div class="bracket-team-row ${winner === away ? "selected" : ""}">
          ${renderBracketSlot(match.away, match.number, away)}
          <button class="winner-button" data-match-winner="${match.number}" data-team="${away || ""}" ${!away || state.prediction.isDefinitive ? "disabled" : ""} type="button">Pasa</button>
        </div>
      </div>
    `;
  }

  function renderBracketSlot(slot, matchNumber, resolvedTeam) {
    if (slot.startsWith("3rd Group")) {
      const group = state.prediction.bracket.thirdSlots[String(matchNumber)];
      return resolvedTeam
        ? `<span class="team-name">${teamLabel(resolvedTeam)}<small>3º grupo ${group}</small></span>`
        : `<span class="team-name"><span>${escapeHtml(slot.replace("3rd", "3º"))}</span></span>`;
    }
    return `<span class="team-name">${resolvedTeam ? teamLabel(resolvedTeam) : `<span>${escapeHtml(translateSlot(slot))}</span>`}</span>`;
  }

  function renderMatchPredictions() {
    const visibleMatches = schedule.filter((match) => isMatchVisibleForPrediction(match));
    const completed = visibleMatches.filter((match) => isMatchPredictionComplete(match)).length;
    const byStage = visibleMatches.reduce((stages, match) => {
      stages[match.stage] ||= [];
      stages[match.stage].push(match);
      return stages;
    }, {});

    return `
      <div class="section-heading">
        <div>
          <p class="eyebrow">Marcadores exactos</p>
          <h2>Pronostica cada resultado</h2>
          <p class="muted">Puedes modificar cada marcador hasta que empiece ese partido. Los cruces de eliminatorias aparecen cuando quedan resueltos en tu cuadro.</p>
        </div>
      </div>
      <div class="results-toolbar">
        <span>${completed} / ${visibleMatches.length} marcadores completados</span>
        <span>${schedule.length - visibleMatches.length} partidos aún pendientes de cruce</span>
      </div>
      <div class="stage-stack">
        ${Object.entries(byStage)
          .map(
            ([stage, matches]) => `
              <article class="stage-card">
                <div class="stage-heading">
                  <h3>${stage}</h3>
                  <span>${matches.length} ${matches.length === 1 ? "partido visible" : "partidos visibles"}</span>
                </div>
                <div class="result-grid">
                  ${matches.map(renderMatchPredictionCard).join("")}
                </div>
              </article>`,
          )
          .join("")}
      </div>
    `;
  }

  function renderMatchPredictionCard(match) {
    const key = matchPredictionKey(match.number);
    const prediction = state.prediction.matchPredictions[key] || {};
    const { home, away } = resolvedMatchTeams(match);
    const lockedByTime = hasMatchStarted(match);
    const locked = state.prediction.isDefinitive || lockedByTime;
    const lockText = state.prediction.isDefinitive ? "Porra definitiva" : lockedByTime ? "Partido iniciado" : "Editable";

    return `
      <article class="result-match">
        <div class="fixture-meta">
          <strong>Partido ${match.number}</strong>
          <span>${formatScheduleDate(match)}</span>
        </div>
        <div class="result-lock ${locked ? "locked" : ""}">${lockText}</div>
        ${renderResultScoreInput(match, "homeScore", home, prediction.homeScore, locked)}
        ${renderResultScoreInput(match, "awayScore", away, prediction.awayScore, locked)}
        <p class="tiny muted">${escapeHtml(match.venue)}</p>
      </article>
    `;
  }

  function renderResultScoreInput(match, side, teamId, value, locked) {
    return `
      <label class="result-score-row">
        <span class="team-name">${teamLabel(teamId)}</span>
        <input
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="2"
          value="${escapeHtml(value ?? "")}"
          data-result-match="${match.number}"
          data-result-side="${side}"
          aria-label="Goles de ${escapeHtml(teams.get(teamId)?.name || "equipo")}"
          ${locked ? "disabled" : ""}
        />
      </label>
    `;
  }

  function renderExtras() {
    const extras = state.prediction.extras;
    return `
      <div class="section-heading">
        <div>
          <p class="eyebrow">Pronósticos especiales</p>
          <h2>Afina tu apuesta</h2>
          <p class="muted">Estos premios pueden marcar la diferencia al final del torneo.</p>
        </div>
      </div>
      <div class="prediction-grid">
        <article class="card">
          <h3>Selecciones</h3>
          <label class="field"><span>Equipo más goleador</span><select class="select" data-extra="highestScoringTeam" ${state.prediction.isDefinitive ? "disabled" : ""}>${teamOptions(extras.highestScoringTeam)}</select></label>
          <label class="field"><span>Equipo más goleado</span><select class="select" data-extra="mostConcededTeam" ${state.prediction.isDefinitive ? "disabled" : ""}>${teamOptions(extras.mostConcededTeam)}</select></label>
          <label class="field"><span>Equipo con más rojas</span><select class="select" data-extra="mostRedsTeam" ${state.prediction.isDefinitive ? "disabled" : ""}>${teamOptions(extras.mostRedsTeam)}</select></label>
          <label class="field"><span>Equipo con menos rojas</span><select class="select" data-extra="fewestRedsTeam" ${state.prediction.isDefinitive ? "disabled" : ""}>${teamOptions(extras.fewestRedsTeam)}</select></label>
        </article>
        <article class="card">
          <h3>Jugadores</h3>
          <div class="notice notice-warm">Todavía no están todos los jugadores: las convocatorias definitivas se importarán y validarán antes de abrir la porra pública.</div>
          <label class="field"><span>Máximo goleador</span><select class="select" data-extra="topScorer" ${state.prediction.isDefinitive ? "disabled" : ""}>${playerOptions(extras.topScorer)}</select></label>
          <label class="field"><span>MVP del Mundial</span><select class="select" data-extra="mvp" ${state.prediction.isDefinitive ? "disabled" : ""}>${playerOptions(extras.mvp)}</select></label>
        </article>
      </div>
    `;
  }

  function renderXi() {
    const counts = xiCounts();
    return `
      <div class="section-heading">
        <div>
          <p class="eyebrow">Tu selección ideal</p>
          <h2>Elige tu once</h2>
          <p class="muted">1 portero, 4 defensas, 4 mediocampistas y 2 delanteros.</p>
        </div>
      </div>
      <div class="position-counter">
        ${Object.entries(xiLimits)
          .map(
            ([position, limit]) =>
              `<span class="${counts[position] === limit ? "complete" : ""}">${position} · ${counts[position]} / ${limit}</span>`,
          )
          .join("")}
      </div>
      <div class="stage-stack">
        ${Object.keys(xiLimits)
          .map(
            (position) => `
              <article class="stage-card">
                <div class="stage-heading"><h3>${xiLabels[position]}</h3><span>${counts[position]} / ${xiLimits[position]}</span></div>
                <div class="player-grid">
                  ${data.players
                    .filter((player) => player.position === position)
                    .map((player) => {
                      const selected = state.prediction.xi.includes(player.id);
                      return `
                        <button class="player-chip ${selected ? "selected" : ""}" data-xi-player="${player.id}" ${state.prediction.isDefinitive ? "disabled" : ""} type="button">
                          ${flag(player.team)}<span>${escapeHtml(player.name)}</span>
                        </button>`;
                    })
                    .join("")}
                </div>
              </article>`,
          )
          .join("")}
      </div>
    `;
  }

  function renderMatches() {
    const adminResults = currentAdminResults();
    const byDate = schedule.reduce((days, match) => {
      days[match.date] ||= [];
      days[match.date].push(match);
      return days;
    }, {});
    return `
      <div class="page-shell">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Calendario oficial</p>
            <h1>Todos los partidos</h1>
            <p class="muted">Los 104 encuentros y sus fechas. Cuando el administrador publique un resultado, también aparecerán sus estadísticas.</p>
          </div>
        </div>
        <div class="notice">Las horas se muestran con la zona horaria local publicada para cada sede. Los cruces posteriores a grupos se completarán automáticamente cuando se conozcan los clasificados.</div>
        <div class="calendar-stack">
          ${Object.entries(byDate)
            .map(
              ([date, matches]) => `
                <section class="calendar-day">
                  <h2>${formatDate(date)}</h2>
                  <div class="calendar-grid">${matches.map((match) => renderScheduledMatch(match, adminResults[String(match.number)])).join("")}</div>
                </section>`,
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function renderScheduledMatch(match, result) {
    const home = scheduleTeam(match.home);
    const away = scheduleTeam(match.away);
    return `
      <article class="calendar-match">
        <div class="fixture-meta"><strong>Partido ${match.number} · ${match.stage}</strong><span>${escapeHtml(match.time)}</span></div>
        <div class="calendar-team"><span class="team-name">${home.id ? teamLabel(home.id) : `<span>${escapeHtml(home.name)}</span>`}</span><strong>${result?.homeScore ?? ""}</strong></div>
        <div class="calendar-team"><span class="team-name">${away.id ? teamLabel(away.id) : `<span>${escapeHtml(away.name)}</span>`}</span><strong>${result?.awayScore ?? ""}</strong></div>
        <p class="tiny muted">${escapeHtml(match.venue)}</p>
        ${result?.events?.length ? `<div class="event-list">${result.events.map(renderAdminEvent).join("")}</div>` : ""}
      </article>`;
  }

  function renderValidatedMatch(match) {
    const home = teams.get(match.home_team_id);
    const away = teams.get(match.away_team_id);
    const scheduledAt = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(match.scheduled_at),
    );
    return `
      <article class="card match-card">
        <span class="status-badge">Ficha validada</span>
        <div class="match-score">
          <div class="match-team">${flag(home?.id)}<span>${escapeHtml(home?.name || "Por confirmar")}</span></div>
          <strong class="score">${match.home_score ?? "-"} · ${match.away_score ?? "-"}</strong>
          <div class="match-team">${flag(away?.id)}<span>${escapeHtml(away?.name || "Por confirmar")}</span></div>
        </div>
        <p class="tiny muted">${escapeHtml(match.stage)} · ${escapeHtml(scheduledAt)}</p>
      </article>`;
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  }

  function formatScheduleDate(match) {
    return `${formatDate(match.date)} · ${match.time}`;
  }

  function scheduleUtc(match) {
    const time = match.time.match(/^(\d+):(\d+) ([ap])\.m\. UTC([+-]\d+)$/);
    if (!time) return `${match.date}T12:00:00Z`;
    const [, rawHour, rawMinute, meridiem, rawOffset] = time;
    let hour = Number(rawHour) % 12;
    if (meridiem === "p") hour += 12;
    const [year, month, day] = match.date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour - Number(rawOffset), Number(rawMinute))).toISOString();
  }

  function scheduleTeam(value) {
    return teams.has(value) ? { id: value, name: teams.get(value).name } : { id: "", name: translateSlot(value) };
  }

  function matchPredictionKey(matchNumber) {
    return String(matchNumber);
  }

  function resolvedMatchTeams(match, prediction = state.prediction) {
    return {
      home: resolveSlot(match.home, match.number, prediction),
      away: resolveSlot(match.away, match.number, prediction),
    };
  }

  function isMatchVisibleForPrediction(match, prediction = state.prediction) {
    const { home, away } = resolvedMatchTeams(match, prediction);
    return Boolean(home && away);
  }

  function hasMatchStarted(match) {
    return Date.now() >= new Date(scheduleUtc(match)).getTime();
  }

  function isMatchPredictionComplete(match, prediction = state.prediction) {
    const matchPrediction = prediction.matchPredictions?.[matchPredictionKey(match.number)];
    return matchPrediction?.homeScore !== undefined && matchPrediction?.homeScore !== "" && matchPrediction?.awayScore !== undefined && matchPrediction?.awayScore !== "";
  }

  function translateSlot(value) {
    return String(value)
      .replace("Winner Group", "1º grupo")
      .replace("Runner-up Group", "2º grupo")
      .replace("Winner Match", "Ganador partido")
      .replace("Loser Match", "Perdedor partido")
      .replace("3rd Group", "3º grupo");
  }

  function groupTeamAt(group, position, prediction = state.prediction) {
    return Object.entries(prediction.groups[group] || {}).find(([, value]) => String(value) === String(position))?.[0] || "";
  }

  function resolveSlot(slot, matchNumber, prediction = state.prediction) {
    if (teams.has(slot)) return slot;
    let match = String(slot).match(/^Winner Group ([A-L])$/);
    if (match) return groupTeamAt(match[1], 1, prediction);
    match = String(slot).match(/^Runner-up Group ([A-L])$/);
    if (match) return groupTeamAt(match[1], 2, prediction);
    match = String(slot).match(/^Winner Match (\d+)$/);
    if (match) return prediction.bracket?.winners?.[match[1]] || "";
    match = String(slot).match(/^Loser Match (\d+)$/);
    if (match) return loserForMatch(Number(match[1]), prediction);
    if (String(slot).startsWith("3rd Group")) {
      const group = prediction.bracket?.thirdSlots?.[String(matchNumber)];
      return group ? groupTeamAt(group, 3, prediction) : "";
    }
    return "";
  }

  function loserForMatch(matchNumber, prediction = state.prediction) {
    const match = knockoutMatches.find((candidate) => candidate.number === Number(matchNumber));
    if (!match) return "";
    const home = resolveSlot(match.home, match.number, prediction);
    const away = resolveSlot(match.away, match.number, prediction);
    const winner = prediction.bracket?.winners?.[String(match.number)];
    if (!home || !away || !winner) return "";
    return winner === home ? away : home;
  }

  function sanitizeBracket() {
    const bracket = state.prediction.bracket;
    bracket.thirdQualifiers = bracket.thirdQualifiers.filter((group) => groupTeamAt(group, 3));
    Object.entries(bracket.thirdSlots).forEach(([matchNumber, group]) => {
      const match = knockoutMatches.find((candidate) => String(candidate.number) === String(matchNumber));
      const allowed = match?.away.startsWith("3rd Group") ? match.away.replace("3rd Group ", "").split("/") : [];
      if (!bracket.thirdQualifiers.includes(group) || !allowed.includes(group)) delete bracket.thirdSlots[matchNumber];
    });
    knockoutMatches.forEach((match) => {
      const winner = bracket.winners[String(match.number)];
      const candidates = [resolveSlot(match.home, match.number), resolveSlot(match.away, match.number)];
      if (winner && !candidates.includes(winner)) delete bracket.winners[String(match.number)];
    });
    Object.keys(state.prediction.matchPredictions || {}).forEach((matchNumber) => {
      const match = schedule.find((candidate) => String(candidate.number) === String(matchNumber));
      if (!match || !isMatchVisibleForPrediction(match)) delete state.prediction.matchPredictions[matchNumber];
    });
  }

  function autoAssignThirdSlots() {
    const bracket = state.prediction.bracket;
    bracket.thirdSlots = {};
    if (bracket.thirdQualifiers.length !== 8) return;
    const variableMatches = knockoutMatches
      .filter((match) => match.home.startsWith("3rd Group") || match.away.startsWith("3rd Group"))
      .map((match) => {
        const slot = match.home.startsWith("3rd Group") ? match.home : match.away;
        return { number: String(match.number), allowed: slot.replace("3rd Group ", "").split("/") };
      })
      .sort((a, b) => a.allowed.length - b.allowed.length);
    function assign(index, used) {
      if (index === variableMatches.length) return true;
      const match = variableMatches[index];
      for (const group of bracket.thirdQualifiers) {
        if (used.has(group) || !match.allowed.includes(group)) continue;
        bracket.thirdSlots[match.number] = group;
        used.add(group);
        if (assign(index + 1, used)) return true;
        used.delete(group);
        delete bracket.thirdSlots[match.number];
      }
      return false;
    }
    assign(0, new Set());
  }

  function toggleThirdQualifier(group) {
    if (state.prediction.isDefinitive || !groupTeamAt(group, 3)) return;
    const selected = state.prediction.bracket.thirdQualifiers;
    if (selected.includes(group)) {
      state.prediction.bracket.thirdQualifiers = selected.filter((candidate) => candidate !== group);
    } else if (selected.length < 8) {
      selected.push(group);
    }
    autoAssignThirdSlots();
    sanitizeBracket();
  }

  function chooseMatchWinner(matchNumber, teamId) {
    if (state.prediction.isDefinitive || !teamId) return;
    state.prediction.bracket.winners[String(matchNumber)] = teamId;
    sanitizeBracket();
  }

  function renderAdminEvent(event) {
    const player = players.get(event.playerId);
    return `<div class="event-item"><span class="event-minute">${escapeHtml(event.minute || "0")}'</span><span class="event-copy"><strong>${escapeHtml(player?.name || "Sin jugador")}</strong> · ${escapeHtml(event.type)}</span></div>`;
  }

  function renderAdminSavedMatch(number, result) {
    const match = schedule.find((candidate) => String(candidate.number) === String(number));
    const home = result.homeTeamId || (teams.has(match?.home) ? match.home : "");
    const away = result.awayTeamId || (teams.has(match?.away) ? match.away : "");
    return `
      <div class="admin-saved-match">
        <div class="summary-item">
          <span>Partido ${number}${match ? ` · ${escapeHtml(match.stage)}` : ""}</span>
          <strong>${home ? escapeHtml(teams.get(home).name) : "Local"} ${result.homeScore} · ${result.awayScore} ${away ? escapeHtml(teams.get(away).name) : "Visitante"}</strong>
        </div>
        ${
          result.events?.length
            ? `<div class="event-list">
                ${result.events
                  .map((event, index) => {
                    const player = players.get(event.playerId);
                    const eventKey = event.id || event.supabaseId || String(index);
                    return `<div class="event-item admin-event-row">
                      <span class="event-minute">${escapeHtml(event.minute || "0")}'</span>
                      <span class="event-copy"><strong>${escapeHtml(player?.name || "Sin jugador")}</strong> · ${escapeHtml(event.type)}</span>
                      <button class="button button-mini" data-delete-admin-event="${escapeHtml(number)}" data-event-key="${escapeHtml(eventKey)}" type="button">Eliminar</button>
                    </div>`;
                  })
                  .join("")}
              </div>`
            : '<p class="tiny muted">Sin eventos publicados.</p>'
        }
      </div>
    `;
  }

  function renderAdmin() {
    if (!state.user?.isAdmin) {
      return `<div class="page-shell page-narrow"><div class="card empty-state"><div class="empty-icon">26</div><h3>Zona reservada</h3><p class="muted">Este panel solo está disponible para el administrador.</p></div></div>`;
    }
    const saved = currentAdminResults();
    const scorecards = currentLeaderboard();
    return `
      <div class="page-shell page-narrow">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Zona privada</p>
            <h1>Administración</h1>
            <p class="muted">Publica el resultado de un partido y añade sus eventos. En producción, Supabase restringe estas acciones a tu usuario administrador.</p>
          </div>
        </div>
        <form class="card admin-form" id="admin-result-form">
          <h3>Guardar o corregir resultado</h3>
          <label class="field"><span>Partido</span><select class="select" name="matchNumber" required>${schedule.map((match) => `<option value="${match.number}">Partido ${match.number} · ${escapeHtml(scheduleTeam(match.home).name)} - ${escapeHtml(scheduleTeam(match.away).name)} · ${match.date}</option>`).join("")}</select></label>
          <div class="score-inputs">
            <label class="field"><span>Equipo local real, opcional</span><select class="select" name="homeTeamId">${teamOptions("", "Según calendario")}</select></label>
            <label class="field"><span>Equipo visitante real, opcional</span><select class="select" name="awayTeamId">${teamOptions("", "Según calendario")}</select></label>
          </div>
          <div class="score-inputs">
            <label class="field"><span>Goles local</span><input name="homeScore" inputmode="numeric" pattern="\\d+" type="text" required /></label>
            <label class="field"><span>Goles visitante</span><input name="awayScore" inputmode="numeric" pattern="\\d+" type="text" required /></label>
          </div>
          <button class="button button-dark" type="submit">Guardar resultado y recalcular</button>
        </form>
        <form class="card admin-form" id="admin-event-form">
          <h3>Añadir evento</h3>
          <label class="field"><span>Partido</span><select class="select" name="matchNumber" required>${schedule.map((match) => `<option value="${match.number}">Partido ${match.number}</option>`).join("")}</select></label>
          <label class="field"><span>Jugador</span><select class="select" name="playerId" required>${playerOptions()}</select></label>
          <label class="field"><span>Tipo</span><select class="select" name="type"><option value="gol">Gol</option><option value="penalti marcado">Penalti marcado</option><option value="penalti fallado">Penalti fallado</option><option value="penalti parado">Penalti parado</option><option value="amarilla">Tarjeta amarilla</option><option value="roja">Tarjeta roja</option><option value="MVP">MVP del partido</option></select></label>
          <label class="field"><span>Minuto</span><input name="minute" inputmode="numeric" pattern="\\d+" type="text" required /></label>
          <button class="button button-dark" type="submit">Añadir evento</button>
        </form>
        <article class="card">
          <h3>Partidos publicados</h3>
          <div class="summary-list">${Object.entries(saved).length ? Object.entries(saved).map(([number, result]) => renderAdminSavedMatch(number, result)).join("") : '<p class="muted">Todavía no has publicado resultados.</p>'}</div>
          ${Object.entries(saved).length ? '<button class="button" data-action="clear-admin-demo" type="button">Vaciar datos de prueba</button>' : ""}
        </article>
        <article class="card">
          <h3>Puntuaciones recalculadas</h3>
          <div class="summary-list">${scorecards.length ? scorecards.map((player) => `<div class="summary-item"><span>${escapeHtml(player.name)}</span><strong>${player.points} pts</strong></div>`).join("") : '<p class="muted">Aún no hay participantes registrados.</p>'}</div>
        </article>
        ${renderAdminUsers()}
      </div>`;
  }

  function adminUsers() {
    if (supabase) {
      return state.communityPlayers.map((player) => ({
        id: player.id,
        name: player.name,
        email: "Email privado",
        isAdmin: Boolean(player.isAdmin),
        points: player.points,
      }));
    }
    return getLocalJson(localKeys.users, []).map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: Boolean(user.isAdmin),
      points: scorecardForUser(user.id, getLocalJson(localKeys.predictions, {})[user.id]).total,
    }));
  }

  function renderAdminUsers() {
    const users = adminUsers();
    return `
      <article class="card">
        <h3>Usuarios</h3>
        <p class="muted">Las contraseñas se guardan cifradas/hasheadas y no se pueden ver. Solo puedes resetearlas.</p>
        <div class="admin-user-list">
          ${
            users.length
              ? users
                  .map(
                    (user) => `
                      <div class="admin-user-row">
                        <span><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)} · ${user.points} pts</small></span>
                        <span class="button-row">
                          <button class="button button-mini" data-toggle-admin-user="${escapeHtml(user.id)}" ${user.email === defaultAdminEmail ? "disabled" : ""} type="button">${user.isAdmin ? "Quitar admin" : "Hacer admin"}</button>
                          ${supabase || user.email === defaultAdminEmail ? "" : `<button class="button button-mini" data-reset-user-password="${escapeHtml(user.id)}" type="button">Reset password</button>`}
                          <button class="button button-mini" data-delete-user="${escapeHtml(user.id)}" ${user.id === state.user?.id || user.email === defaultAdminEmail ? "disabled" : ""} type="button">Eliminar</button>
                        </span>
                      </div>`,
                  )
                  .join("")
              : '<p class="muted">Aún no hay usuarios.</p>'
          }
        </div>
      </article>
    `;
  }

  async function saveAdminResult(values) {
    if (!state.user?.isAdmin) return;
    const number = String(values.get("matchNumber"));
    const match = schedule.find((candidate) => String(candidate.number) === number);
    const saved = getLocalJson(localKeys.adminMatches, {});
    const homeTeamId = String(values.get("homeTeamId") || "");
    const awayTeamId = String(values.get("awayTeamId") || "");
    saved[number] = {
      ...(saved[number] || {}),
      homeScore: Number(values.get("homeScore")),
      awayScore: Number(values.get("awayScore")),
      homeTeamId,
      awayTeamId,
      events: saved[number]?.events || [],
    };
    setLocalJson(localKeys.adminMatches, saved);
    if (supabase && match) {
      const { data: tournament } = await supabase.from("tournaments").select("id").eq("slug", "world-cup-2026").single();
      const { error } = await supabase.from("matches").upsert({
        id: `wc26-${number}`,
        tournament_id: tournament.id,
        stage: match.stage,
        home_team_id: homeTeamId || (teams.has(match.home) ? match.home : null),
        away_team_id: awayTeamId || (teams.has(match.away) ? match.away : null),
        scheduled_at: scheduleUtc(match),
        venue: match.venue,
        status: "validated",
        home_score: saved[number].homeScore,
        away_score: saved[number].awayScore,
        validated_at: new Date().toISOString(),
      });
      if (error) alert(`El resultado se ha guardado en la demo, pero Supabase ha respondido: ${error.message}`);
      await syncSupabaseScores();
    }
    render();
  }

  async function saveAdminEvent(values) {
    if (!state.user?.isAdmin) return;
    const number = String(values.get("matchNumber"));
    const saved = getLocalJson(localKeys.adminMatches, {});
    saved[number] ||= { homeScore: "", awayScore: "", events: [] };
    const event = {
      id: crypto.randomUUID(),
      playerId: String(values.get("playerId")),
      type: String(values.get("type")),
      minute: Number(values.get("minute")),
    };
    saved[number].events ||= [];
    saved[number].events.push(event);
    setLocalJson(localKeys.adminMatches, saved);
    if (supabase) {
      const player = players.get(event.playerId);
      const eventTypes = {
        gol: "goal",
        "penalti marcado": "penalty_goal",
        "penalti fallado": "penalty_miss",
        "penalti parado": "penalty_save",
        amarilla: "yellow_card",
        roja: "red_card",
        MVP: "mvp",
      };
      const { data: inserted, error } = await supabase.from("match_events").insert({
        match_id: `wc26-${number}`,
        event_type: eventTypes[event.type],
        player_id: event.playerId,
        team_id: player?.team || null,
        minute: event.minute,
      }).select("id").single();
      if (inserted?.id) {
        event.supabaseId = inserted.id;
        setLocalJson(localKeys.adminMatches, saved);
      }
      if (error) alert(`El evento se ha guardado en la demo, pero Supabase ha respondido: ${error.message}`);
      await syncSupabaseScores();
    }
    render();
  }

  async function deleteAdminEvent(matchNumber, eventKey) {
    if (!state.user?.isAdmin) return;
    const saved = getLocalJson(localKeys.adminMatches, {});
    if (!saved[matchNumber]) return;
    const events = saved[matchNumber]?.events || [];
    const event = events.find((candidate, index) => String(candidate.id || candidate.supabaseId || index) === String(eventKey));
    saved[matchNumber].events = events.filter((candidate, index) => String(candidate.id || candidate.supabaseId || index) !== String(eventKey));
    setLocalJson(localKeys.adminMatches, saved);
    if (supabase && event?.supabaseId) {
      const { error } = await supabase.from("match_events").delete().eq("id", event.supabaseId);
      if (error) alert(`El evento se ha borrado en la demo, pero Supabase ha respondido: ${error.message}`);
      await syncSupabaseScores();
    }
    render();
  }

  async function syncSupabaseScores() {
    if (!supabase) return;
    const { error } = await supabase.rpc("recalculate_scores");
    if (error) alert(`No se ha podido recalcular en Supabase. Revisa si aplicaste la migración 003: ${error.message}`);
    await loadSupabasePublicData();
  }

  function clearAdminDemo() {
    if (!state.user?.isAdmin) return;
    localStorage.removeItem(localKeys.adminMatches);
    state.user.points = 0;
    render();
  }

  async function deleteUser(userId) {
    if (!state.user?.isAdmin || userId === state.user.id) return;
    if (!window.confirm("¿Seguro que quieres eliminar este usuario y su porra?")) return;
    if (supabase) {
      const player = state.communityPlayers.find((candidate) => candidate.id === userId);
      if (player?.email === defaultAdminEmail) return;
      const { error } = await supabase.rpc("admin_delete_user", { target_user_id: userId });
      if (error) alert(`No se ha podido borrar el usuario: ${error.message}`);
      await loadSupabasePublicData();
      render();
      return;
    }
    const existingUsers = getLocalJson(localKeys.users, []);
    if (existingUsers.find((user) => user.id === userId)?.email === defaultAdminEmail) return;
    const users = existingUsers.filter((user) => user.id !== userId);
    const predictions = getLocalJson(localKeys.predictions, {});
    delete predictions[userId];
    setLocalJson(localKeys.users, users);
    setLocalJson(localKeys.predictions, predictions);
    render();
  }

  async function toggleAdminUser(userId) {
    if (!state.user?.isAdmin) return;
    if (supabase) {
      const player = state.communityPlayers.find((candidate) => candidate.id === userId);
      if (player?.email === defaultAdminEmail) return;
      const { error } = await supabase.rpc("admin_set_user_admin", { target_user_id: userId, next_is_admin: !player?.isAdmin });
      if (error) alert(`No se ha podido cambiar el rol: ${error.message}`);
      await loadSupabasePublicData();
      render();
      return;
    }
    const users = getLocalJson(localKeys.users, []);
    const user = users.find((candidate) => candidate.id === userId);
    if (user?.email === defaultAdminEmail) return;
    if (user) user.isAdmin = !user.isAdmin;
    setLocalJson(localKeys.users, users);
    if (state.user.id === userId) state.user.isAdmin = Boolean(user?.isAdmin);
    render();
  }

  async function resetLocalUserPassword(userId) {
    if (!state.user?.isAdmin || supabase) return;
    const users = getLocalJson(localKeys.users, []);
    const user = users.find((candidate) => candidate.id === userId);
    if (user?.email === defaultAdminEmail) return;
    const password = window.prompt("Nueva contraseña para este usuario (mínimo 5 caracteres):");
    if (!password) return;
    if (password.length < 5) {
      alert("La contraseña debe tener al menos 5 caracteres.");
      return;
    }
    if (!user) return;
    user.passwordHash = await digest(password);
    setLocalJson(localKeys.users, users);
    alert("Contraseña actualizada en la demo local.");
  }

  function currentLeaderboard() {
    const playersList = supabase
      ? state.communityPlayers.map((player) => ({ ...player, isCurrent: player.id === state.user?.id }))
      : localLeaderboardPlayers();
    return playersList.sort(
      (a, b) => b.points - a.points || b.complete - a.complete || a.name.localeCompare(b.name),
    );
  }

  function localLeaderboardPlayers() {
    const users = getLocalJson(localKeys.users, []);
    const predictions = getLocalJson(localKeys.predictions, {});
    if (!users.length) return [];
    return users
      .filter((user) => user.email !== defaultAdminEmail || user.id === state.user?.id)
      .map((user) => {
        const prediction = normalizePrediction(user.id === state.user?.id ? state.prediction : predictions[user.id]);
        const scorecard = scorecardForUser(user.id, prediction);
        return {
          id: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl || "",
          initials: initials(user.name),
          points: scorecard.total,
          complete: user.id === state.user?.id ? calculateCompletion() : calculateCompletionForPrediction(prediction),
          champion: prediction.bracket.winners["104"] || "",
          prediction,
          scorecard,
          isCurrent: user.id === state.user?.id,
        };
      });
  }

  function renderLeaderboard() {
    const leaderboard = currentLeaderboard();
    return `
      <div class="page-shell">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Todos los participantes</p>
            <h1>Clasificación</h1>
            <p class="muted">Los puntos se actualizarán después de validar cada jornada.</p>
          </div>
        </div>
        <div class="notice">Antes del primer partido, la tabla se ordena por porcentaje completado. Cuando empiece el torneo, mandan los puntos.</div>
        <div class="button-row leaderboard-actions">
          <button class="button button-dark" data-action="open-score-chart" type="button">Ver gráfica de evolución</button>
        </div>
        <section class="card leaderboard">
          <div class="leader-row leader-row-header"><span>Puesto</span><span>Jugador</span><span>Ganador</span><span>Puntos</span><span>Porra</span></div>
          ${leaderboard
            .map(
              (player, index) => `
              <div class="leader-row">
                <span class="rank">${index + 1}</span>
                <span class="leader-person">${renderAvatar(player)}<strong>${escapeHtml(player.name)}${player.isCurrent ? " · tú" : ""}</strong></span>
                <span class="team-name">${player.champion ? teamLabel(player.champion) : "<span>Pendiente</span>"}</span>
                <span class="leader-points">${player.points}</span>
                <button class="button" data-public-profile="${escapeHtml(player.id)}" type="button">Ver porra</button>
              </div>`,
            )
            .join("")}
        </section>
        ${leaderboard.length ? "" : '<div class="card empty-state"><div class="empty-icon">0</div><h3>Aún no hay participantes</h3><p class="muted">Cuando tus amigos se registren, aparecerán aquí.</p></div>'}
      </div>
    `;
  }

  function scoreEvolution(player) {
    const entries = [...(player.scorecard?.entries || [])].sort(
      (a, b) => (a.matchNumber || 999) - (b.matchNumber || 999) || String(a.sourceRef).localeCompare(String(b.sourceRef)),
    );
    const pointsByMatch = new Map();
    entries.forEach((entry) => {
      const matchNumber = entry.matchNumber || 0;
      pointsByMatch.set(matchNumber, (pointsByMatch.get(matchNumber) || 0) + entry.points);
    });
    let total = 0;
    return Array.from(pointsByMatch.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([matchNumber, points]) => {
        total += points;
        return { matchNumber, total };
      });
  }

  function renderScoreChart(playersList = currentLeaderboard()) {
    const width = 720;
    const height = 320;
    const padding = 38;
    const colors = ["#4caf50", "#ffdd44", "#2f7d32", "#d88735", "#657568", "#1f3327"];
    const series = playersList.map((player) => ({ player, points: scoreEvolution(player) }));
    const maxMatch = Math.max(1, ...series.flatMap((item) => item.points.map((point) => point.matchNumber)));
    const maxPoints = Math.max(1, ...series.flatMap((item) => item.points.map((point) => point.total)), ...playersList.map((player) => player.points || 0));
    const x = (matchNumber) => padding + (Math.max(0, matchNumber) / maxMatch) * (width - padding * 2);
    const y = (points) => height - padding - (Math.max(0, points) / maxPoints) * (height - padding * 2);
    const pathFor = (points) => {
      const normalized = [{ matchNumber: 0, total: 0 }, ...points];
      return normalized.map((point, index) => `${index ? "L" : "M"} ${x(point.matchNumber).toFixed(1)} ${y(point.total).toFixed(1)}`).join(" ");
    };

    return `
      <button class="modal-close" data-action="close-score-chart" type="button" aria-label="Cerrar">×</button>
      <p class="eyebrow">Clasificación</p>
      <h2>Evolución de puntos</h2>
      <p class="muted">La gráfica acumula los puntos por partido según las entradas calculadas. Si el admin corrige un dato, la curva se regenera.</p>
      ${
        playersList.length
          ? `<div class="score-chart-wrap">
              <svg class="score-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolución de puntos de participantes">
                <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" />
                <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" />
                <text x="${padding}" y="${height - 10}">Inicio</text>
                <text x="${width - padding - 38}" y="${height - 10}">Final</text>
                <text x="10" y="${padding + 4}">${maxPoints} pts</text>
                ${series
                  .map(
                    (item, index) => `
                      <path d="${pathFor(item.points)}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
                      <circle cx="${x(item.points.at(-1)?.matchNumber || 0).toFixed(1)}" cy="${y(item.points.at(-1)?.total || 0).toFixed(1)}" r="5" fill="${colors[index % colors.length]}" />
                    `,
                  )
                  .join("")}
              </svg>
              <div class="chart-legend">
                ${series
                  .map(
                    (item, index) => `<span><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(item.player.name)} · ${item.player.points} pts</span>`,
                  )
                  .join("")}
              </div>
            </div>`
          : '<p class="muted">Todavía no hay participantes para pintar la evolución.</p>'
      }
    `;
  }

  function openScoreChart() {
    document.querySelector("#score-chart-content").innerHTML = renderScoreChart();
    scoreChartDialog.showModal();
  }

  function renderProfile() {
    if (!state.user) {
      return `
        <div class="page-shell page-narrow">
          <div class="card empty-state">
            <div class="empty-icon">26</div>
            <h3>Entra para ver tu perfil</h3>
            <p class="muted">Desde aquí podrás consultar tus puntos, tus aciertos y tu porra completa.</p>
            <button class="button button-dark" data-action="open-auth" type="button">Crear cuenta o entrar</button>
          </div>
        </div>`;
    }

    const scorecard = currentUserScorecard();
    const lockedAdmin = state.user.email === defaultAdminEmail;
    return `
      <div class="page-shell page-narrow">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Tu espacio</p>
            <h1>Mi perfil</h1>
          </div>
        </div>
        <article class="profile-card">
          ${renderAvatar(state.user)}
          <div>
            <h3>${escapeHtml(state.user.name)}</h3>
            <p class="muted">${escapeHtml(state.user.email)}</p>
            <div class="button-row">
              <button class="button button-dark" data-go="porra" type="button">Editar mi porra</button>
              <button class="button" data-action="logout" type="button">Cerrar sesión</button>
            </div>
          </div>
        </article>
        <form class="card profile-edit-form" id="profile-form">
          <p class="eyebrow">Perfil</p>
          <h3>Editar usuario y avatar</h3>
          ${lockedAdmin ? '<div class="notice">El usuario administrador principal tiene el nombre y el rol bloqueados.</div>' : ""}
          <label class="field">
            <span>Nombre visible</span>
            <input name="displayName" type="text" value="${escapeAttr(state.user.name)}" minlength="2" maxlength="40" ${lockedAdmin ? "disabled" : ""} required />
          </label>
          <div class="field">
            <span>Avatar</span>
            <div class="avatar-options">
              ${avatarPresets
                .map(
                  (preset) => `
                    <label class="avatar-choice">
                      <input name="avatarPreset" type="radio" value="${escapeAttr(preset.id)}" ${state.user.avatarUrl === `preset:${preset.id}` ? "checked" : ""} />
                      ${renderAvatar({ name: state.user.name, avatarUrl: `preset:${preset.id}` })}
                    </label>`,
                )
                .join("")}
              <label class="avatar-choice">
                <input name="avatarPreset" type="radio" value="" ${!state.user.avatarUrl || !state.user.avatarUrl.startsWith("preset:") ? "checked" : ""} />
                ${renderAvatar(state.user)}
              </label>
            </div>
          </div>
          <label class="field">
            <span>Subir foto de avatar</span>
            <input name="avatarFile" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <button class="button button-dark" type="submit">Guardar perfil</button>
          <p class="form-message" id="profile-message" role="status"></p>
        </form>
        <section class="stats-strip">
          <article class="stat-card"><span>Puntos</span><strong>${scorecard.total}</strong><small>Actualizados</small></article>
          <article class="stat-card"><span>Porra</span><strong>${calculateCompletion()}%</strong><small>Completada</small></article>
          <article class="stat-card"><span>Jugadas</span><strong>${scorecard.entries.length}</strong><small>Con puntos</small></article>
          <article class="stat-card"><span>Categorías</span><strong>${scorecard.categories.length}</strong><small>Puntuadas</small></article>
        </section>
        ${renderPredictionSummary(state.prediction)}
        ${renderScoreBreakdown(scorecard, "Detalle de tus puntos")}
      </div>
    `;
  }

  function readFileDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(file);
    });
  }

  async function saveProfile(form) {
    if (!state.user) return;
    const values = new FormData(form);
    const lockedAdmin = state.user.email === defaultAdminEmail;
    const message = document.querySelector("#profile-message");
    const nextName = lockedAdmin ? state.user.name : String(values.get("displayName") || "").trim();
    if (!nextName || nextName.length < 2) {
      message.textContent = "El nombre debe tener al menos 2 caracteres.";
      return;
    }
    let avatarUrl = state.user.avatarUrl || "";
    const file = values.get("avatarFile");
    const preset = String(values.get("avatarPreset") || "");
    if (file && file.size) {
      if (file.size > 350 * 1024) {
        message.textContent = "La imagen debe pesar menos de 350 KB.";
        return;
      }
      avatarUrl = await readFileDataUrl(file);
    } else if (preset) {
      avatarUrl = `preset:${preset}`;
    }

    if (supabase) {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: nextName, avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq("id", state.user.id);
      if (error) {
        message.textContent = `No se ha podido guardar: ${error.message}`;
        return;
      }
      await loadSupabasePublicData();
    } else {
      const users = getLocalJson(localKeys.users, []);
      const user = users.find((candidate) => candidate.id === state.user.id);
      if (user) {
        user.name = nextName;
        user.avatarUrl = avatarUrl;
        setLocalJson(localKeys.users, users);
      }
    }
    state.user.name = nextName;
    state.user.avatarUrl = avatarUrl;
    render();
    const nextMessage = document.querySelector("#profile-message");
    if (nextMessage) nextMessage.textContent = "Perfil actualizado.";
  }

  function renderPredictionSummary(prediction) {
    const champion = prediction.bracket?.winners?.["104"] || "";
    const runnerUp = loserForMatch(104, prediction) || "";
    const third = prediction.bracket?.winners?.["103"] || "";
    const extras = prediction.extras || {};
    const visibleMatches = schedule.filter((match) => {
      const { home, away } = resolvedMatchTeams(match, prediction);
      return Boolean(home && away);
    });
    const completedMatches = visibleMatches.filter((match) => {
      const matchPrediction = prediction.matchPredictions?.[matchPredictionKey(match.number)];
      return matchPrediction?.homeScore !== undefined && matchPrediction?.homeScore !== "" && matchPrediction?.awayScore !== undefined && matchPrediction?.awayScore !== "";
    }).length;
    return `
      <article class="card">
        <p class="eyebrow">Resumen del pronóstico</p>
        <h3>Tu porra guardada</h3>
        <div class="summary-list">
          <div class="summary-item"><span>Campeón</span><strong class="team-name">${champion ? teamLabel(champion) : "Pendiente"}</strong></div>
          <div class="summary-item"><span>Subcampeón</span><strong class="team-name">${runnerUp ? teamLabel(runnerUp) : "Pendiente"}</strong></div>
          <div class="summary-item"><span>Tercer puesto</span><strong class="team-name">${third ? teamLabel(third) : "Pendiente"}</strong></div>
          <div class="summary-item"><span>Máximo goleador</span><strong>${extras.topScorer ? escapeHtml(players.get(extras.topScorer)?.name) : "Pendiente"}</strong></div>
          <div class="summary-item"><span>MVP del Mundial</span><strong>${extras.mvp ? escapeHtml(players.get(extras.mvp)?.name) : "Pendiente"}</strong></div>
          <div class="summary-item"><span>Marcadores</span><strong>${completedMatches} / ${visibleMatches.length}</strong></div>
          <div class="summary-item"><span>Once ideal</span><strong>${prediction.xi?.length || 0} / 11</strong></div>
        </div>
        <p class="tiny muted">Cuando empiece el Mundial, cada apartado mostrará sus aciertos, fallos y puntos adjudicados.</p>
      </article>
    `;
  }

  function renderScoreBreakdown(scorecard, title = "Detalle de puntos") {
    const categories = scorecard.categories || [];
    return `
      <article class="card score-breakdown">
        <div class="score-breakdown-head">
          <div>
            <p class="eyebrow">Puntuación</p>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <strong>${scorecard.total || 0}</strong>
        </div>
        ${
          categories.length
            ? `<div class="score-category-grid">
                ${categories
                  .map(
                    (category) => `
                      <section class="score-category">
                        <div class="stage-heading"><h4>${escapeHtml(category.label)}</h4><span>${category.total} pts</span></div>
                        <div class="score-entry-list">
                          ${category.entries
                            .map(
                              (entry) => `
                                <div class="score-entry">
                                  <span>${escapeHtml(entry.explanation)}</span>
                                  <strong class="${entry.points < 0 ? "negative" : ""}">${entry.points > 0 ? "+" : ""}${entry.points}</strong>
                                </div>`,
                            )
                            .join("")}
                        </div>
                      </section>`,
                  )
                  .join("")}
              </div>`
            : '<p class="muted">Todavía no hay puntos adjudicados. Cuando el admin valide resultados o eventos, este panel se actualizará automáticamente.</p>'
        }
      </article>
    `;
  }

  function renderReadonlyGroups(prediction) {
    const groups = Object.keys(prediction.groups || {}).sort();
    return `
      <article class="card">
        <p class="eyebrow">Grupos</p>
        <h3>Clasificación elegida</h3>
        <div class="readonly-grid">
          ${groups
            .map((group) => {
              const rows = Object.entries(prediction.groups[group] || {})
                .filter(([, position]) => position)
                .sort((a, b) => Number(a[1]) - Number(b[1]));
              return `
                <section class="readonly-box">
                  <h4>Grupo ${escapeHtml(group)}</h4>
                  ${rows.length ? rows.map(([teamId, position]) => `<div class="summary-item"><span>${position}º</span><strong class="team-name">${teamLabel(teamId)}</strong></div>`).join("") : '<p class="muted">Sin completar.</p>'}
                </section>`;
            })
            .join("")}
        </div>
      </article>`;
  }

  function renderReadonlyBracket(prediction) {
    return `
      <article class="card">
        <p class="eyebrow">Eliminatorias</p>
        <h3>Cuadro elegido</h3>
        <div class="readonly-grid">
          ${knockoutStages
            .map((stage) => {
              const matches = knockoutMatches.filter((match) => match.stage === stage);
              return `
                <section class="readonly-box">
                  <h4>${escapeHtml(stage)}</h4>
                  ${matches
                    .map((match) => {
                      const home = resolveSlot(match.home, match.number, prediction);
                      const away = resolveSlot(match.away, match.number, prediction);
                      const winner = prediction.bracket?.winners?.[String(match.number)] || "";
                      return `<div class="readonly-match">
                        <span>Partido ${match.number}</span>
                        <div class="team-name ${winner === home ? "picked" : ""}">${home ? teamLabel(home) : `<span>${escapeHtml(translateSlot(match.home))}</span>`}</div>
                        <div class="team-name ${winner === away ? "picked" : ""}">${away ? teamLabel(away) : `<span>${escapeHtml(translateSlot(match.away))}</span>`}</div>
                      </div>`;
                    })
                    .join("")}
                </section>`;
            })
            .join("")}
        </div>
      </article>`;
  }

  function renderReadonlyExtras(prediction) {
    const extras = prediction.extras || {};
    const playerName = (id) => players.get(id)?.name || "Pendiente";
    return `
      <article class="card">
        <p class="eyebrow">Extras</p>
        <h3>Apuestas especiales</h3>
        <div class="summary-list">
          <div class="summary-item"><span>Equipo más goleador</span><strong class="team-name">${extras.highestScoringTeam ? teamLabel(extras.highestScoringTeam) : "Pendiente"}</strong></div>
          <div class="summary-item"><span>Equipo más goleado</span><strong class="team-name">${extras.mostConcededTeam ? teamLabel(extras.mostConcededTeam) : "Pendiente"}</strong></div>
          <div class="summary-item"><span>Más rojas</span><strong class="team-name">${extras.mostRedsTeam ? teamLabel(extras.mostRedsTeam) : "Pendiente"}</strong></div>
          <div class="summary-item"><span>Menos rojas</span><strong class="team-name">${extras.fewestRedsTeam ? teamLabel(extras.fewestRedsTeam) : "Pendiente"}</strong></div>
          <div class="summary-item"><span>Máximo goleador</span><strong>${escapeHtml(playerName(extras.topScorer))}</strong></div>
          <div class="summary-item"><span>MVP Mundial</span><strong>${escapeHtml(playerName(extras.mvp))}</strong></div>
        </div>
      </article>`;
  }

  function renderReadonlyXi(prediction) {
    const selected = prediction.xi || [];
    return `
      <article class="card">
        <p class="eyebrow">Once ideal</p>
        <h3>Jugadores elegidos</h3>
        <div class="readonly-player-grid">
          ${selected.length ? selected.map((playerId) => {
            const player = players.get(playerId);
            return `<div class="player-chip selected">${flag(player?.team)}<span>${escapeHtml(player?.name || "Jugador")}</span><small>${escapeHtml(player?.position || "")}</small></div>`;
          }).join("") : '<p class="muted">Sin once elegido.</p>'}
        </div>
      </article>`;
  }

  function renderReadonlyPlayedMatches(prediction) {
    const results = currentAdminResults();
    const played = schedule.filter((match) => results[String(match.number)]?.homeScore !== undefined && results[String(match.number)]?.awayScore !== undefined);
    return `
      <article class="card">
        <p class="eyebrow">Partidos disputados</p>
        <h3>Resultados y pronóstico</h3>
        <div class="readonly-match-list">
          ${played.length ? played.map((match) => {
            const result = results[String(match.number)];
            const forecast = prediction.matchPredictions?.[String(match.number)] || {};
            const home = result.homeTeamId || (teams.has(match.home) ? match.home : "");
            const away = result.awayTeamId || (teams.has(match.away) ? match.away : "");
            return `<div class="readonly-played-match">
              <span>Partido ${match.number}</span>
              <strong>${home ? teams.get(home)?.name : translateSlot(match.home)} ${result.homeScore}-${result.awayScore} ${away ? teams.get(away)?.name : translateSlot(match.away)}</strong>
              <small>Pronóstico: ${forecast.homeScore ?? "-"}-${forecast.awayScore ?? "-"}</small>
            </div>`;
          }).join("") : '<p class="muted">Todavía no hay partidos publicados por el administrador.</p>'}
        </div>
      </article>`;
  }

  function renderFullPredictionReadOnly(prediction) {
    return `
      <section class="public-prediction-grid">
        ${renderReadonlyGroups(prediction)}
        ${renderReadonlyBracket(prediction)}
        ${renderReadonlyExtras(prediction)}
        ${renderReadonlyXi(prediction)}
        ${renderReadonlyPlayedMatches(prediction)}
      </section>`;
  }

  function calculateCompletion() {
    return calculateCompletionForPrediction(state.prediction);
  }

  function calculateCompletionForPrediction(prediction) {
    const groupDone = Object.values(prediction.groups).reduce((total, group) => {
      const positions = Object.values(group).filter(Boolean);
      return total + (positions.length === 4 && new Set(positions).size === 4 ? 1 : 0);
    }, 0);
    const bracketDone = Object.keys(prediction.bracket.winners).length;
    const thirdsDone = prediction.bracket.thirdQualifiers.length === 8 ? 1 : 0;
    const visibleMatches = schedule.filter((match) => isMatchVisibleForPrediction(match, prediction));
    const resultsDone = visibleMatches.filter((match) => isMatchPredictionComplete(match, prediction)).length;
    const extrasDone = Object.values(prediction.extras).filter(Boolean).length;
    const counts = xiCounts(prediction);
    const xiDone = Object.entries(xiLimits).every(([position, limit]) => counts[position] === limit) ? 1 : 0;
    const completedUnits = groupDone + thirdsDone + bracketDone + resultsDone + extrasDone + xiDone;
    const totalUnits = 12 + 1 + knockoutMatches.length + visibleMatches.length + Object.keys(prediction.extras).length + 1;
    return Math.round((completedUnits / totalUnits) * 100);
  }

  function xiCounts(prediction = state.prediction) {
    return prediction.xi.reduce(
      (counts, playerId) => {
        const position = players.get(playerId)?.position;
        if (position) counts[position] += 1;
        return counts;
      },
      { POR: 0, DEF: 0, MED: 0, DEL: 0 },
    );
  }

  function toggleXi(playerId) {
    const selected = state.prediction.xi;
    if (selected.includes(playerId)) {
      state.prediction.xi = selected.filter((id) => id !== playerId);
      return;
    }
    const player = players.get(playerId);
    if (player && xiCounts()[player.position] < xiLimits[player.position]) selected.push(playerId);
  }

  async function savePrediction(makeDefinitive = false) {
    if (!state.user) {
      openAuth();
      return;
    }
    if (state.prediction.isDefinitive) {
      alert("Esta porra ya es definitiva y no admite cambios.");
      return;
    }
    if (
      makeDefinitive &&
      !window.confirm("¿Confirmas que esta es tu porra definitiva? Después de guardarla ya no podrás cambiarla.")
    ) {
      return;
    }
    if (makeDefinitive) state.prediction.isDefinitive = true;
    state.prediction.updatedAt = new Date().toISOString();
    if (supabase) {
      const { data: tournament, error: tournamentError } = await supabase
        .from("tournaments")
        .select("id")
        .eq("slug", "world-cup-2026")
        .single();
      if (tournamentError) {
        alert(`No se ha podido cargar el torneo: ${tournamentError.message}`);
        return;
      }
      const { error } = await supabase.from("predictions").upsert(
        {
          user_id: state.user.id,
          tournament_id: tournament.id,
          selections: state.prediction,
          completion_percent: calculateCompletion(),
          is_definitive: state.prediction.isDefinitive,
          updated_at: state.prediction.updatedAt,
        },
        { onConflict: "user_id" },
      );
      if (error) {
        if (makeDefinitive) state.prediction.isDefinitive = false;
        alert(`No se ha podido guardar: ${error.message}`);
        return;
      }
    } else {
      const predictions = getLocalJson(localKeys.predictions, {});
      predictions[state.user.id] = state.prediction;
      setLocalJson(localKeys.predictions, predictions);
    }
    render();
  }

  function openAuth(mode = "register") {
    state.authMode = mode;
    syncAuthDialog();
    authDialog.showModal();
  }

  function syncAuthDialog() {
    const register = state.authMode === "register";
    const passwordInput = document.querySelector("[name='password']");
    const confirmPasswordInput = document.querySelector("[name='confirmPassword']");
    const confirmPasswordField = document.querySelector("#confirm-password-field");
    document.querySelector("#auth-title").textContent = register ? "Crea tu cuenta" : "Bienvenido de nuevo";
    document.querySelector("#name-field").hidden = !register;
    confirmPasswordField.hidden = !register;
    confirmPasswordField.setAttribute("aria-hidden", String(!register));
    confirmPasswordInput.disabled = !register;
    confirmPasswordInput.required = register;
    if (!register) confirmPasswordInput.value = "";
    passwordInput.autocomplete = register ? "new-password" : "current-password";
    document.querySelector("[data-action='forgot-password']").hidden = register;
    document.querySelector("#auth-submit").textContent = register ? "Crear cuenta" : "Entrar";
    document.querySelector("#auth-message").textContent = "";
    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.authMode === state.authMode);
    });
  }

  async function submitAuth(form) {
    const values = new FormData(form);
    const name = String(values.get("name") || "").trim();
    const email = String(values.get("email") || "").trim().toLowerCase();
    const password = String(values.get("password") || "");
    const confirmPassword = String(values.get("confirmPassword") || "");
    const message = document.querySelector("#auth-message");
    if (state.authMode === "register" && !name) {
      message.textContent = "Añade un nombre visible.";
      return;
    }
    if (state.authMode === "register" && password.length < 5) {
      message.textContent = "La contraseña debe tener al menos 5 caracteres.";
      return;
    }
    if (state.authMode === "login" && !password) {
      message.textContent = "Escribe tu contraseña.";
      return;
    }
    if (state.authMode === "register" && password !== confirmPassword) {
      message.textContent = "Las contraseñas no coinciden.";
      return;
    }

    state.authBusy = true;
    document.querySelector("#auth-submit").disabled = true;
    try {
      if (supabase) {
        const result =
          state.authMode === "register"
            ? await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } })
            : await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        if (state.authMode === "register" && !result.data.session) {
          message.textContent = "Revisa tu email para confirmar la cuenta.";
          return;
        }
        await loadSupabaseUser(result.data.user);
      } else {
        const users = getLocalJson(localKeys.users, []);
        const passwordHash = await digest(password);
        if (state.authMode === "register") {
          if (users.some((user) => user.email === email)) throw new Error("Ese email ya está registrado.");
          const user = {
            id: crypto.randomUUID(),
            name,
            email,
            passwordHash,
            points: 0,
            isAdmin: Boolean(config.adminEmails?.includes(email)),
          };
          users.push(user);
          setLocalJson(localKeys.users, users);
          localStorage.setItem(localKeys.currentEmail, email);
          state.user = user;
          state.prediction = emptyPrediction();
        } else {
          const user = users.find((candidate) => candidate.email === email && candidate.passwordHash === passwordHash);
          if (!user) throw new Error("Email o contraseña incorrectos.");
          localStorage.setItem(localKeys.currentEmail, email);
          state.user = user;
          const predictions = getLocalJson(localKeys.predictions, {});
          state.prediction = normalizePrediction(predictions[user.id]);
        }
      }
      authDialog.close();
      form.reset();
      render();
    } catch (error) {
      message.textContent = error.message || "No se ha podido completar el acceso.";
    } finally {
      state.authBusy = false;
      document.querySelector("#auth-submit").disabled = false;
    }
  }

  async function requestPasswordReset() {
    const form = document.querySelector("#auth-form");
    const values = new FormData(form);
    const email = String(values.get("email") || "").trim().toLowerCase();
    const message = document.querySelector("#auth-message");
    if (!email) {
      message.textContent = "Escribe tu email y pulsa de nuevo.";
      return;
    }
    if (supabase) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      message.textContent = error ? `No se ha podido enviar: ${error.message}` : "Te hemos enviado un email para recuperar la contraseña.";
      return;
    }
    message.textContent = "En la demo local no hay envío de email. El admin puede resetear tu contraseña desde Admin > Usuarios.";
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    else localStorage.removeItem(localKeys.currentEmail);
    state.user = null;
    state.prediction = emptyPrediction();
    go("inicio");
    render();
  }

  function showPublicProfile(id) {
    const profile = currentLeaderboard().find((player) => player.id === id);
    if (!profile) return;
    const prediction = profile.prediction;
    const scorecard = profile.scorecard || scoring.scorecardFromEntries([]);
    const champion = profile.champion ? teamLabel(profile.champion) : "<span>Pendiente</span>";
    const runnerUpId = prediction ? loserForMatch(104, prediction) : "";
    const runnerUp = runnerUpId ? teamLabel(runnerUpId) : "<span>Pendiente</span>";
    const scorerId = prediction?.extras?.topScorer || "";
    const mvpId = prediction?.extras?.mvp || "";
    document.querySelector("#public-profile-content").innerHTML = `
      <button class="modal-close" data-action="close-public-profile" type="button" aria-label="Cerrar">×</button>
      <p class="eyebrow">Porra pública</p>
      <div class="public-profile-head">${renderAvatar(profile)}<div><h2>${escapeHtml(profile.name)}</h2><p class="muted">${scorecard.total} puntos · ${profile.complete}% completada</p></div></div>
      <div class="summary-list">
        <div class="summary-item"><span>Campeón</span><strong class="team-name">${champion}</strong></div>
        <div class="summary-item"><span>Subcampeón</span><strong class="team-name">${runnerUp}</strong></div>
        <div class="summary-item"><span>Máximo goleador</span><strong>${escapeHtml(players.get(scorerId)?.name || "Pendiente")}</strong></div>
        <div class="summary-item"><span>MVP</span><strong>${escapeHtml(players.get(mvpId)?.name || "Pendiente")}</strong></div>
        <div class="summary-item"><span>Once ideal</span><strong>${prediction?.xi?.length || (profile.isCurrent ? 0 : 11)} / 11</strong></div>
      </div>
      ${renderFullPredictionReadOnly(prediction || emptyPrediction())}
      ${renderScoreBreakdown(scorecard, `Puntos de ${profile.name}`)}
      <p class="tiny muted">El detalle completo se recalcula cada vez que el administrador valida o corrige datos.</p>
    `;
    publicProfileDialog.showModal();
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.matches("a[href^='#']")) {
      event.preventDefault();
      go(target.getAttribute("href").slice(1) || "inicio");
      return;
    }
    if (target.dataset.go) go(target.dataset.go);
    if (target.dataset.section) {
      state.section = target.dataset.section;
      render();
    }
    if (target.dataset.thirdGroup) {
      toggleThirdQualifier(target.dataset.thirdGroup);
      render();
    }
    if (target.dataset.matchWinner) {
      chooseMatchWinner(target.dataset.matchWinner, target.dataset.team);
      render();
    }
    if (target.dataset.xiPlayer) {
      toggleXi(target.dataset.xiPlayer);
      render();
    }
    if (target.dataset.moveGroupTeam) {
      moveGroupTeam(target.dataset.moveGroupTeam, target.dataset.team, target.dataset.direction);
      render();
    }
    if (target.dataset.publicProfile) showPublicProfile(target.dataset.publicProfile);
    if (target.dataset.authMode) {
      state.authMode = target.dataset.authMode;
      syncAuthDialog();
    }
    if (target.dataset.action === "open-auth") openAuth();
    if (target.dataset.action === "save-prediction") savePrediction();
    if (target.dataset.action === "finalize-prediction") savePrediction(true);
    if (target.dataset.action === "logout") logout();
    if (target.dataset.action === "clear-admin-demo") clearAdminDemo();
    if (target.dataset.action === "open-score-chart") openScoreChart();
    if (target.dataset.action === "close-score-chart") scoreChartDialog.close();
    if (target.dataset.action === "forgot-password") requestPasswordReset();
    if (target.dataset.deleteUser) deleteUser(target.dataset.deleteUser);
    if (target.dataset.toggleAdminUser) toggleAdminUser(target.dataset.toggleAdminUser);
    if (target.dataset.resetUserPassword) resetLocalUserPassword(target.dataset.resetUserPassword);
    if (target.dataset.deleteAdminEvent) deleteAdminEvent(target.dataset.deleteAdminEvent, target.dataset.eventKey);
    if (target.dataset.action === "close-public-profile") publicProfileDialog.close();
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.dataset.groupTeam) {
      state.prediction.groups[target.dataset.group][target.dataset.groupTeam] = target.value;
      render();
    }
    if (target.dataset.thirdSlot) {
      state.prediction.bracket.thirdSlots[target.dataset.thirdSlot] = target.value;
      sanitizeBracket();
      render();
    }
    if (target.dataset.extra) {
      state.prediction.extras[target.dataset.extra] = target.value;
      render();
    }
  });

  document.addEventListener("dragstart", (event) => {
    const item = event.target.closest(".group-sort-item");
    if (!item || state.prediction.isDefinitive) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify({ group: item.dataset.group, team: item.dataset.team }));
    item.classList.add("dragging");
  });

  document.addEventListener("dragend", (event) => {
    const item = event.target.closest(".group-sort-item");
    if (item) item.classList.remove("dragging");
    document.querySelectorAll(".group-sort-item.drag-over").forEach((node) => node.classList.remove("drag-over"));
  });

  document.addEventListener("dragover", (event) => {
    const item = event.target.closest(".group-sort-item");
    if (!item || state.prediction.isDefinitive) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".group-sort-item.drag-over").forEach((node) => {
      if (node !== item) node.classList.remove("drag-over");
    });
    item.classList.add("drag-over");
  });

  document.addEventListener("dragleave", (event) => {
    const item = event.target.closest(".group-sort-item");
    if (item) item.classList.remove("drag-over");
  });

  document.addEventListener("drop", (event) => {
    const targetItem = event.target.closest(".group-sort-item");
    if (!targetItem || state.prediction.isDefinitive) return;
    event.preventDefault();
    targetItem.classList.remove("drag-over");
    let payload;
    try {
      payload = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (!payload || payload.group !== targetItem.dataset.group || payload.team === targetItem.dataset.team) return;
    const groupTeams = data.teams.filter((team) => team.group === payload.group);
    const ordered = orderedGroupTeams(payload.group, groupTeams).map((team) => team.id);
    const from = ordered.indexOf(payload.team);
    const to = ordered.indexOf(targetItem.dataset.team);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    setGroupOrder(payload.group, ordered);
    render();
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!target.dataset.resultMatch || !target.dataset.resultSide) return;
    const match = schedule.find((candidate) => String(candidate.number) === String(target.dataset.resultMatch));
    if (state.prediction.isDefinitive || !match || hasMatchStarted(match)) return;
    const key = matchPredictionKey(match.number);
    state.prediction.matchPredictions[key] ||= {};
    state.prediction.matchPredictions[key][target.dataset.resultSide] = target.value.replace(/\D/g, "").slice(0, 2);
    target.value = state.prediction.matchPredictions[key][target.dataset.resultSide];
  });

  window.addEventListener("hashchange", () => {
    state.route = window.location.hash.replace("#", "") || "inicio";
    window.scrollTo({ top: 0, behavior: "auto" });
    render();
  });

  document.querySelector("#profile-button").addEventListener("click", () => {
    if (state.user) go("perfil");
    else openAuth();
  });
  document.querySelector("#auth-close").addEventListener("click", () => authDialog.close());
  document.querySelector("#auth-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitAuth(event.currentTarget);
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id === "admin-result-form") {
      event.preventDefault();
      saveAdminResult(new FormData(event.target));
    }
    if (event.target.id === "admin-event-form") {
      event.preventDefault();
      saveAdminEvent(new FormData(event.target));
    }
    if (event.target.id === "profile-form") {
      event.preventDefault();
      saveProfile(event.target);
    }
  });

  restoreSession().then(render);
})();
