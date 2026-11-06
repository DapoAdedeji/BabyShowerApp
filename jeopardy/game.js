// ============================================================
// BABY SHOWER JEOPARDY — GAME LOGIC
// You shouldn't need to touch this file to customize the game —
// edit questions.js instead. This file just runs the board.
//
// Teams come from the shared ShowerSession (see ../session.js),
// registered via the Leaderboard. If no teams are registered yet,
// this page shows a gate screen pointing the host there first.
// ============================================================

(async function () {
  // Questions edited in the admin screen (saved in Cloudflare KV) win over
  // questions.js. If none are saved, or the API isn't reachable (e.g. running
  // locally with `npx serve`), the game uses questions.js as before.
  const DATA = await loadQuestions(window.GAME_DATA);

  let teams = [];       // local copy of ShowerSession teams: [{ name, score, color }]
  let usedClues = new Set(); // keys like "0-2"
  let activeClue = null;     // { catIdx, clueIdx, value }
  let totalClues = 0;

  // ---------- DOM refs ----------
  const screenGate = document.getElementById('screen-gate');
  const screenStart = document.getElementById('screen-start');
  const screenBoard = document.getElementById('screen-board');
  const screenFinal = document.getElementById('screen-final');

  const teamRosterEl = document.getElementById('team-roster');
  const btnStart = document.getElementById('btn-start');

  const scoreboardEl = document.getElementById('scoreboard');
  const boardEl = document.getElementById('board');
  const clueCounterEl = document.getElementById('clue-counter');
  const btnEndGame = document.getElementById('btn-end-game');
  const btnEditScores = document.getElementById('btn-edit-scores');

  const modal = document.getElementById('clue-modal');
  const modalCategory = document.getElementById('modal-category');
  const modalValue = document.getElementById('modal-value');
  const modalClue = document.getElementById('modal-clue');
  const modalAnswer = document.getElementById('modal-answer');
  const btnReveal = document.getElementById('btn-reveal');
  const awardSection = document.getElementById('award-section');
  const awardButtons = document.getElementById('award-buttons');
  const btnNoOne = document.getElementById('btn-no-one');

  const finalRankings = document.getElementById('final-rankings');
  const confettiField = document.getElementById('confetti-field');
  const btnPlayAgain = document.getElementById('btn-play-again');

  // ---------- Init text from data ----------
  document.getElementById('title-text').textContent = DATA.title || 'Baby Shower Jeopardy!';
  document.getElementById('subtitle-text').textContent = DATA.subtitle || '';
  document.title = DATA.title || 'Baby Shower Jeopardy!';

  // ---------- Screen switching ----------
  function showScreen(screen) {
    [screenGate, screenStart, screenBoard, screenFinal].forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
  }

  // ---------- Gate: teams must be registered on the Leaderboard first ----------
  if (!window.ShowerSession || !ShowerSession.hasTeams()) {
    showScreen(screenGate);
    return; // nothing else in this file matters until teams exist
  }

  teams = ShowerSession.getTeams().map(t => ({ ...t }));

  function renderRoster() {
    teamRosterEl.innerHTML = '';
    teams.forEach(team => {
      const row = document.createElement('div');
      row.className = 'team-input-row';
      row.innerHTML = `
        <span class="swatch" style="background:${team.color}"></span>
        <span class="roster-name">${escapeHtml(team.name)}</span>
      `;
      teamRosterEl.appendChild(row);
    });
  }
  renderRoster();
  showScreen(screenStart);

  // ---------- Start game ----------
  btnStart.addEventListener('click', () => {
    usedClues = new Set();
    totalClues = DATA.categories.reduce((sum, c) => sum + c.clues.length, 0);
    showScreen(screenBoard);
    renderBoard();
    renderScoreboard();
    updateClueCounter();
  });

  // ---------- Board rendering ----------
  function renderBoard() {
    const numCats = DATA.categories.length;
    boardEl.style.gridTemplateColumns = `repeat(${numCats}, 1fr)`;
    boardEl.innerHTML = '';

    DATA.categories.forEach(cat => {
      const header = document.createElement('div');
      header.className = 'cat-header';
      header.textContent = cat.title;
      boardEl.appendChild(header);
    });

    const maxRows = Math.max(...DATA.categories.map(c => c.clues.length));
    for (let row = 0; row < maxRows; row++) {
      DATA.categories.forEach((cat, catIdx) => {
        const clue = cat.clues[row];
        if (!clue) {
          const spacer = document.createElement('div');
          boardEl.appendChild(spacer);
          return;
        }
        const key = `${catIdx}-${row}`;
        const tile = document.createElement('button');
        tile.className = 'clue-tile' + (usedClues.has(key) ? ' used' : '');
        tile.textContent = `${clue.value}`;
        tile.disabled = usedClues.has(key);
        tile.addEventListener('click', () => openClue(catIdx, row));
        boardEl.appendChild(tile);
      });
    }
  }

  function updateClueCounter() {
    const remaining = totalClues - usedClues.size;
    clueCounterEl.textContent = `${remaining} / ${totalClues} clues left`;
  }

  // ---------- Scoreboard ----------
  function renderScoreboard() {
    const maxScore = Math.max(...teams.map(t => t.score));
    scoreboardEl.innerHTML = '';
    teams.forEach(team => {
      // Chips are buttons: tapping any score opens the manual score editor.
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.title = 'Tap to edit scores';
      chip.addEventListener('click', openScoreEditor);
      chip.className = 'score-chip' + (team.score === maxScore && maxScore > 0 ? ' leading' : '');
      chip.style.borderColor = team.color;
      chip.innerHTML = `
        <span class="chip-name">${escapeHtml(team.name)}</span>
        <span class="chip-score">${team.score}</span>
      `;
      scoreboardEl.appendChild(chip);
    });
  }

  // ---------- Manual score edits (disputes) ----------
  // Writes go straight to the shared leaderboard; we then re-sync our
  // local copy so the scoreboard and award buttons match.
  function openScoreEditor() {
    ScoreEditor.open({
      step: 100,
      onSave: (updated) => {
        teams = updated.map(t => ({ ...t }));
        renderScoreboard();
      }
    });
  }
  btnEditScores.addEventListener('click', openScoreEditor);

  // ---------- Clue modal ----------
  function openClue(catIdx, clueIdx) {
    const cat = DATA.categories[catIdx];
    const clue = cat.clues[clueIdx];
    activeClue = { catIdx, clueIdx, value: clue.value };

    modalCategory.textContent = cat.title;
    modalValue.textContent = clue.value;
    modalClue.textContent = clue.clue;
    modalAnswer.textContent = clue.answer || '';
    modalAnswer.classList.remove('visible');
    btnReveal.style.display = 'inline-block';
    awardSection.classList.add('hidden');

    renderAwardButtons();
    modal.classList.add('active');
  }

  function renderAwardButtons() {
    awardButtons.innerHTML = '';
    teams.forEach((team, i) => {
      const btn = document.createElement('button');
      btn.className = 'award-btn';
      btn.style.borderColor = team.color;
      btn.textContent = `${team.name} +${activeClue ? activeClue.value : ''}`;
      btn.addEventListener('click', () => awardPoints(i));
      awardButtons.appendChild(btn);
    });
  }

  btnReveal.addEventListener('click', () => {
    modalAnswer.classList.add('visible');
    btnReveal.style.display = 'none';
    awardSection.classList.remove('hidden');
  });

  function awardPoints(teamIdx) {
    if (!activeClue) return;
    teams[teamIdx].score += activeClue.value;
    // Persist to the shared leaderboard so it reflects across the whole event.
    ShowerSession.updateScore(teamIdx, activeClue.value);
    closeClue();
  }

  btnNoOne.addEventListener('click', () => closeClue());

  function closeClue() {
    if (activeClue) {
      usedClues.add(`${activeClue.catIdx}-${activeClue.clueIdx}`);
    }
    activeClue = null;
    modal.classList.remove('active');
    renderBoard();
    renderScoreboard();
    updateClueCounter();

    if (usedClues.size >= totalClues) {
      setTimeout(endGame, 400);
    }
  }

  // Allow closing modal by clicking outside the card (treated as "no one got it")
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeClue();
  });

  // ---------- End game ----------
  btnEndGame.addEventListener('click', () => {
    if (confirm('End the game now and show final scores?')) endGame();
  });

  function endGame() {
    const sorted = [...teams].sort((a, b) => b.score - a.score);
    const topScore = sorted.length ? sorted[0].score : 0;

    finalRankings.innerHTML = '';
    sorted.forEach(team => {
      const row = document.createElement('div');
      const isWinner = team.score === topScore;
      row.className = 'rank-row' + (isWinner ? ' winner' : '');
      row.style.borderColor = team.color;
      row.innerHTML = `
        <span class="rank-name">${isWinner ? '👑' : ''} ${escapeHtml(team.name)}</span>
        <span class="rank-score">${team.score}</span>
      `;
      finalRankings.appendChild(row);
    });

    launchConfetti();
    showScreen(screenFinal);
  }

  function launchConfetti() {
    confettiField.innerHTML = '';
    const emojis = ['🎉', '🍼', '🧸', '👶', '⭐', '🎈'];
    for (let i = 0; i < 40; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.animationDuration = `${3 + Math.random() * 3}s`;
      piece.style.animationDelay = `${Math.random() * 2}s`;
      confettiField.appendChild(piece);
    }
  }

  // "Play Again" clears the board (used clues) for another round, but
  // deliberately does NOT reset scores — those are the shared, cumulative
  // leaderboard for the whole event.
  btnPlayAgain.addEventListener('click', () => {
    usedClues = new Set();
    showScreen(screenBoard);
    renderBoard();
    renderScoreboard();
    updateClueCounter();
  });

  // ---------- Utils ----------
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function loadQuestions(defaults) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch('/api/questions', { cache: 'no-store', signal: controller.signal });
      if (!res.ok) return defaults;
      const saved = await res.json();
      if (!saved || !Array.isArray(saved.categories) || !saved.categories.length) return defaults;
      return {
        ...defaults,
        title: saved.title || defaults.title,
        subtitle: saved.subtitle || defaults.subtitle,
        categories: saved.categories
      };
    } catch (e) {
      return defaults;
    } finally {
      clearTimeout(timer);
    }
  }
})();
