// ============================================================
// LEADERBOARD — team setup (first run) + running league table
// Reads/writes the shared ShowerSession (see ../session.js) — the
// server copy every other page and every guest phone also uses.
// ============================================================

(function () {
  const MAX_TEAMS = 6;
  const MIN_TEAMS = 2;

  const screenSetup = document.getElementById('screen-setup');
  const screenTable = document.getElementById('screen-table');

  const teamInputsEl = document.getElementById('team-inputs');
  const teamCountLabel = document.getElementById('team-count-label');
  const btnAddTeam = document.getElementById('btn-add-team');
  const btnRemoveTeam = document.getElementById('btn-remove-team');
  const btnStartSession = document.getElementById('btn-start-session');

  const leagueTableEl = document.getElementById('league-table');
  const btnEditTeams = document.getElementById('btn-edit-teams');
  const btnEditScores = document.getElementById('btn-edit-scores');
  const btnResetScores = document.getElementById('btn-reset-scores');
  const btnResetAll = document.getElementById('btn-reset-all');
  const DEFAULT_TEAM_NAMES = ['Team Onesie', 'Team Rattle', 'Team Bootie', 'Team Bibs'];

  let teamNamesState = [...DEFAULT_TEAM_NAMES];

  function showScreen(screen) {
    [screenSetup, screenTable].forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
  }

  // ---------- Setup screen ----------
  function renderTeamInputs() {
    teamInputsEl.innerHTML = '';
    teamNamesState.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'team-input-row';
      row.innerHTML = `
        <span class="swatch" style="background:${ShowerSession.TEAM_COLORS[i % ShowerSession.TEAM_COLORS.length]}"></span>
        <input type="text" value="${escapeAttr(name)}" maxlength="20" data-idx="${i}" placeholder="Team ${i + 1}" />
      `;
      teamInputsEl.appendChild(row);
    });
    teamCountLabel.textContent = `${teamNamesState.length} teams`;
    btnAddTeam.disabled = teamNamesState.length >= MAX_TEAMS;
    btnRemoveTeam.disabled = teamNamesState.length <= MIN_TEAMS;

    teamInputsEl.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', (e) => {
        teamNamesState[+e.target.dataset.idx] = e.target.value;
      });
    });
  }

  btnAddTeam.addEventListener('click', () => {
    if (teamNamesState.length >= MAX_TEAMS) return;
    teamNamesState.push(`Team ${teamNamesState.length + 1}`);
    renderTeamInputs();
  });
  btnRemoveTeam.addEventListener('click', () => {
    if (teamNamesState.length <= MIN_TEAMS) return;
    teamNamesState.pop();
    renderTeamInputs();
  });

  btnStartSession.addEventListener('click', () => {
    ShowerSession.save(teamNamesState);
    editingTeams = false;
    renderTable();
    showScreen(screenTable);
  });

  // ---------- League table screen ----------
  function renderTable() {
    const teams = ShowerSession.getTeams();
    const sorted = [...teams].sort((a, b) => b.score - a.score);
    const topScore = sorted.length ? sorted[0].score : 0;

    leagueTableEl.innerHTML = '';
    sorted.forEach((team, i) => {
      const row = document.createElement('div');
      row.className = 'league-row' + (team.score === topScore && topScore > 0 ? ' first' : '');
      row.style.borderColor = team.color;
      row.innerHTML = `
        <span class="league-rank">#${i + 1}</span>
        <span class="league-swatch" style="background:${team.color}"></span>
        <span class="league-name">${escapeHtml(team.name)}</span>
        <span class="league-score">${team.score}</span>
      `;
      leagueTableEl.appendChild(row);
    });
  }

  btnEditTeams.addEventListener('click', () => {
    // Pre-fill setup with the current roster so edits are easy, not a blank slate.
    const current = ShowerSession.getTeams();
    teamNamesState = current.length ? current.map(t => t.name) : teamNamesState;
    editingTeams = true;
    renderTeamInputs();
    showScreen(screenSetup);
  });

  // Manual score fixes (disputes) — same popup the games use.
  btnEditScores.addEventListener('click', () => {
    ScoreEditor.open({ step: 100, onSave: renderTable });
  });

  // Zero every score but keep the team lineup.
  btnResetScores.addEventListener('click', () => {
    if (!confirm('Reset every team\'s score to 0? Teams stay the same.')) return;
    ShowerSession.resetScores();
    renderTable();
  });

  // Wipe teams AND scores — back to a blank setup screen.
  btnResetAll.addEventListener('click', () => {
    if (!confirm('Reset everything? This deletes all teams and scores.')) return;
    ShowerSession.clear();
    teamNamesState = [...DEFAULT_TEAM_NAMES];
    renderTeamInputs();
    showScreen(screenSetup);
  });

  // ---------- Init ----------
  // Teams live on the server (see ../session.js). Show the last known copy
  // straight away, then follow the server — including changes made on
  // other devices — without interrupting someone editing the lineup.
  let editingTeams = false;

  function showCurrent() {
    if (editingTeams) return;
    if (ShowerSession.hasTeams()) {
      renderTable();
      showScreen(screenTable);
    } else {
      renderTeamInputs();
      showScreen(screenSetup);
    }
  }

  showCurrent();
  ShowerSession.ready.then(showCurrent);
  ShowerSession.onChange(showCurrent);

  // ---------- Utils ----------
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;');
  }
})();
