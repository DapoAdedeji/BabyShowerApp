// ============================================================
// SHOWER SESSION — teams + scores, shared by every admin page
// ============================================================
// The SERVER is the single source of truth (GET/POST /api/leaderboard,
// see worker/index.js). Every admin device, every game and every guest
// phone reads the same teams, so names and scores always match.
//
// - Each change is sent to the server as a small operation ("add 300
//   to team t2"), applied to the server's latest copy, so two devices
//   can't overwrite each other.
// - Changes show instantly on this page, then the server's answer
//   replaces the local copy. If the network blips, changes queue up
//   (kept in this browser) and are sent in order when it's back.
// - Every page re-checks the server every few seconds, so a change made
//   on another device appears here too.
// - Teams have permanent ids ("t1", "t2", …) — use them, not names or
//   positions, to refer to a team.
//
// Include this file before any page-specific script that needs it:
//   <script src="/session.js"></script>
//
// API:
//   ShowerSession.ready              -> Promise, resolves once the server copy is loaded
//   ShowerSession.hasTeams()         -> boolean
//   ShowerSession.getTeams()         -> [{ id, name, score, color }, ...]
//   ShowerSession.save(teamNames)    -> new lineup, all scores 0 (ids kept by position)
//   ShowerSession.addPoints(id, delta)
//   ShowerSession.updateScore(i, delta) -> same, by position (older callers)
//   ShowerSession.setScores([n, ...])   -> overwrite scores (by position; only changed ones are sent)
//   ShowerSession.resetScores()       -> every score back to 0, keeps teams
//   ShowerSession.clear()            -> delete all teams
//   ShowerSession.onChange(fn)       -> fn(teams) whenever teams/scores change
//   ShowerSession.refresh()          -> re-load from the server now
// ============================================================

window.ShowerSession = (function () {
  const CACHE_KEY = 'babyShowerSession_v2';
  const QUEUE_KEY = 'babyShowerSession_queue_v2';
  const LEGACY_KEYS = ['babyShowerSession_v1', 'babyShowerSession_synced'];
  const POLL_MS = 5000;
  const TEAM_COLORS = ['#ff9ecf', '#8fd9f7', '#8fe0b3', '#ffe066', '#c9aef5', '#ffb085'];

  let data = read(CACHE_KEY) || { version: 0, teams: [] };
  let queue = read(QUEUE_KEY) || [];
  const listeners = [];
  let flushing = false;
  let lastEmitted = JSON.stringify(data.teams);

  // ---------- storage helpers (storage can be blocked: never throw) ----------
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* memory only */ }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function emit() {
    const json = JSON.stringify(data.teams);
    if (json === lastEmitted) return;
    lastEmitted = json;
    const teams = getTeams();
    listeners.forEach(fn => { try { fn(teams); } catch (e) { console.error(e); } });
  }

  function adopt(serverData) {
    if (!serverData || !Array.isArray(serverData.teams)) return;
    data = { version: serverData.version || 0, teams: serverData.teams };
    write(CACHE_KEY, data);
    emit();
  }

  // ---------- optimistic local copy of the server's rules ----------
  function nextId(teams) {
    const nums = teams.map(t => Number(String(t.id).replace(/^t/, ''))).filter(Number.isFinite);
    return `t${(nums.length ? Math.max(...nums) : 0) + 1}`;
  }
  function applyLocal(op) {
    const teams = data.teams;
    const find = id => teams.find(t => t.id === id);
    if (op.op === 'create') {
      const next = [];
      op.names.forEach((name, i) => {
        next.push({
          id: teams[i] ? teams[i].id : nextId(teams.concat(next)),
          name: name || `Team ${i + 1}`,
          score: 0,
          color: TEAM_COLORS[i % TEAM_COLORS.length]
        });
      });
      data.teams = next;
    } else if (op.op === 'import') {
      data.teams = op.teams.map((t, i) => ({
        id: `t${i + 1}`, name: t.name, score: t.score || 0, color: TEAM_COLORS[i % TEAM_COLORS.length]
      }));
    } else if (op.op === 'add') {
      const t = find(op.id);
      if (t) t.score += op.delta;
    } else if (op.op === 'set') {
      Object.entries(op.scores).forEach(([id, n]) => { const t = find(id); if (t) t.score = n; });
    } else if (op.op === 'resetScores') {
      teams.forEach(t => { t.score = 0; });
    } else if (op.op === 'clear') {
      data.teams = [];
    }
  }

  // ---------- server ----------
  function send(op) {
    applyLocal(op);
    write(CACHE_KEY, data);
    emit();
    queue.push(op);
    write(QUEUE_KEY, queue);
    flush();
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length) {
        let res;
        try {
          res = await fetch('/api/leaderboard', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(queue[0])
          });
        } catch (e) {
          setTimeout(flush, 3000); // offline — try again shortly
          return;
        }
        if (res.status === 429 || res.status >= 500) {
          await new Promise(r => setTimeout(r, 1200)); // KV: ~1 write/sec per record
          continue;
        }
        if (res.status === 401) return; // signed out; the page will notice
        let body = {};
        try { body = await res.json(); } catch (e) { /* ignore */ }
        queue.shift();
        write(QUEUE_KEY, queue);
        // Success returns the new leaderboard; a rejected change returns the current one.
        if (!queue.length) adopt(res.ok ? body : body.leaderboard);
        if (!res.ok) console.warn('Leaderboard change rejected:', body.error);
      }
    } finally {
      flushing = false;
    }
  }

  async function refresh() {
    if (queue.length || flushing) return; // our own changes win until they're sent
    try {
      const res = await fetch('/api/leaderboard', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      const serverData = await res.json();
      if (queue.length || flushing) return;
      adopt(serverData);
    } catch (e) { /* offline — keep showing the last copy */ }
  }

  // Load from the server; copy up teams from the old browser-only version once.
  const ready = (async () => {
    if (queue.length) await flush();
    await refresh();
    const legacy = read(LEGACY_KEYS[0]);
    if (!data.teams.length && legacy && Array.isArray(legacy.teams) && legacy.teams.length) {
      send({ op: 'import', teams: legacy.teams.map(t => ({ name: t.name, score: Number(t.score) || 0 })) });
      await flush();
    }
    LEGACY_KEYS.forEach(remove);
  })();

  setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  // ---------- public API ----------
  function getTeams() { return data.teams.map(t => ({ ...t })); }
  function hasTeams() { return data.teams.length > 0; }
  function save(teamNames) { send({ op: 'create', names: teamNames.map(n => (n || '').trim()) }); }
  function addPoints(id, delta) { if (delta) send({ op: 'add', id, delta: Math.round(delta) }); }
  function updateScore(i, delta) { const t = data.teams[i]; if (t) addPoints(t.id, delta); }
  function setScores(scores) {
    const changed = {};
    data.teams.forEach((t, i) => {
      const n = Math.round(Number(scores[i]));
      if (Number.isFinite(n) && n !== t.score) changed[t.id] = n;
    });
    if (Object.keys(changed).length) send({ op: 'set', scores: changed });
  }
  function resetScores() { send({ op: 'resetScores' }); }
  function clear() { send({ op: 'clear' }); }
  function onChange(fn) { listeners.push(fn); }

  return {
    ready, hasTeams, getTeams, save, addPoints, updateScore, setScores,
    resetScores, clear, onChange, refresh, TEAM_COLORS
  };
})();
