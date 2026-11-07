// ============================================================
// GUEST LEADERBOARD — view only. Reads the scores the admin app
// syncs to the server (GET /api/leaderboard) and refreshes itself.
// ============================================================
(function () {
  const REFRESH_MS = 10000;
  const tableEl = document.getElementById('league-table');
  const emptyEl = document.getElementById('league-empty');
  const statusText = document.getElementById('league-status-text');
  const statusEl = document.getElementById('league-status');
  let lastJson = '';

  async function refresh() {
    try {
      const res = await fetch('/api/leaderboard', { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 401) { location.href = '/welcome/?next=/guest/leaderboard/'; return; }
      if (!res.ok) throw new Error();
      const data = await res.json();
      const teams = Array.isArray(data.teams) ? data.teams : [];
      const json = JSON.stringify(teams);
      if (json !== lastJson) { render(teams); lastJson = json; }
      statusEl.classList.remove('offline');
      statusText.textContent = `Live · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch (e) {
      statusEl.classList.add('offline');
      statusText.textContent = 'Can\'t reach the scores right now — retrying…';
    }
  }

  function render(teams) {
    tableEl.innerHTML = '';
    emptyEl.hidden = teams.length > 0;
    const sorted = [...teams].sort((a, b) => b.score - a.score);
    const topScore = sorted.length ? sorted[0].score : 0;
    sorted.forEach((team, i) => {
      const row = document.createElement('div');
      row.className = 'league-row' + (team.score === topScore && topScore > 0 ? ' first' : '');
      row.style.borderColor = team.color;

      const rank = document.createElement('span');
      rank.className = 'league-rank';
      rank.textContent = `#${i + 1}`;
      const swatch = document.createElement('span');
      swatch.className = 'league-swatch';
      swatch.style.background = team.color;
      const name = document.createElement('span');
      name.className = 'league-name';
      name.textContent = team.name;
      const score = document.createElement('span');
      score.className = 'league-score';
      score.textContent = team.score;

      row.append(rank, swatch, name, score);
      tableEl.appendChild(row);
    });
  }

  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
