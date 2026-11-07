// ============================================================
// SHOWER SESSION — shared "who's playing" + score state
// ============================================================
// This is the single source of truth for team names/scores across
// every activity in the app (Jeopardy, Karaoke, etc). It's just
// localStorage under the hood, so it persists across page loads
// and is shared by every page on this origin.
//
// Include this file before any page-specific script that needs it:
//   <script src="../session.js"></script>   (from a feature folder)
//   <script src="session.js"></script>      (from the hub root)
//
// API:
//   ShowerSession.hasTeams()         -> boolean
//   ShowerSession.getTeams()         -> [{ name, score, color }, ...]
//   ShowerSession.save(teamNames)    -> creates a fresh session, all scores 0
//   ShowerSession.updateScore(i, delta) -> adds delta to team i's score
//   ShowerSession.setScores([n, ...])   -> overwrites every team's score (manual edits)
//   ShowerSession.resetScores()       -> sets every score back to 0, keeps teams
//   ShowerSession.clear()            -> wipes the session entirely
//
// SERVER COPY FOR GUESTS: this device (the host's) stays the source of
// truth, but every change is also pushed to the server (PUT
// /api/leaderboard) so guests' phones can show a live, view-only
// leaderboard. If a push fails (offline), the next change or page load
// retries it. Only admin pages include this file.
// ============================================================

window.ShowerSession = (function () {
  const KEY = 'babyShowerSession_v1';
  const TEAM_COLORS = ['#ff9ecf', '#8fd9f7', '#8fe0b3', '#ffe066', '#c9aef5', '#ffb085'];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.teams) || !data.teams.length) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function persist(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
    scheduleSync();
  }

  // ---------- Server sync (for the guest leaderboard) ----------
  const SYNCED_KEY = 'babyShowerSession_synced';
  let syncTimer = null;

  function serverCopy() {
    const data = load();
    return JSON.stringify({ teams: data ? data.teams : [] });
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 400);
  }

  async function syncNow() {
    const body = serverCopy();
    let synced = null;
    try { synced = localStorage.getItem(SYNCED_KEY); } catch (e) { /* ignore */ }
    if (body === synced) return; // server already has exactly this
    try {
      const res = await fetch('/api/leaderboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true, // let it finish even if the page is navigating away
        body
      });
      if (res.ok) {
        try { localStorage.setItem(SYNCED_KEY, body); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* offline or no API (e.g. local `npx serve`) — retry next time */ }
  }

  // Catch up on anything that didn't reach the server last time.
  scheduleSync();

  function hasTeams() {
    const data = load();
    return !!(data && data.teams.length);
  }

  function getTeams() {
    const data = load();
    return data ? data.teams : [];
  }

  // teamNames: array of strings. Starts every team's score at 0.
  function save(teamNames) {
    const teams = teamNames.map((name, i) => ({
      name: (name && name.trim()) || `Team ${i + 1}`,
      score: 0,
      color: TEAM_COLORS[i % TEAM_COLORS.length]
    }));
    const data = { teams, startedAt: new Date().toISOString() };
    persist(data);
    return data;
  }

  function updateScore(teamIndex, delta) {
    const data = load();
    if (!data || !data.teams[teamIndex]) return null;
    data.teams[teamIndex].score += delta;
    persist(data);
    return data;
  }

  // scores: array of numbers, one per team (same order as getTeams()).
  function setScores(scores) {
    const data = load();
    if (!data) return null;
    data.teams.forEach((team, i) => {
      const n = Number(scores[i]);
      if (Number.isFinite(n)) team.score = Math.round(n);
    });
    persist(data);
    return data;
  }

  function resetScores() {
    const data = load();
    if (!data) return null;
    data.teams.forEach(team => { team.score = 0; });
    persist(data);
    return data;
  }

  function clear() {
    localStorage.removeItem(KEY);
    scheduleSync();
  }

  return { hasTeams, getTeams, save, updateScore, setScores, resetScores, clear, TEAM_COLORS };
})();
