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
  const modalCard = modal.querySelector('.modal-card');

  const qTimer = document.getElementById('q-timer');
  const timerDisplay = document.getElementById('timer-display');
  const timerFill = document.getElementById('timer-fill');
  const timesUpEl = document.getElementById('times-up');
  const btnTimerStart = document.getElementById('btn-timer-start');
  const btnTimerReset = document.getElementById('btn-timer-reset');
  const btnTimerMinus = document.getElementById('btn-timer-minus');
  const btnTimerPlus = document.getElementById('btn-timer-plus');
  const defaultTimerLabel = document.getElementById('default-timer-label');
  const btnDefaultMinus = document.getElementById('btn-default-minus');
  const btnDefaultPlus = document.getElementById('btn-default-plus');
  const btnSound = document.getElementById('btn-sound');

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
  // Teams come from the server (../session.js), the same copy guests see.
  if (window.ShowerSession) await ShowerSession.ready;
  if (!window.ShowerSession || !ShowerSession.hasTeams()) {
    showScreen(screenGate);
    return; // nothing else in this file matters until teams exist
  }

  teams = ShowerSession.getTeams();

  // Scores or names changed (here, in Edit Scores, or on another device)?
  // Keep the roster, scoreboard and award buttons in step.
  ShowerSession.onChange((latest) => {
    if (!latest.length) return;
    teams = latest;
    renderRoster();
    if (screenBoard.classList.contains('active')) renderScoreboard();
    if (activeClue) renderAwardButtons();
  });

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
        teams = updated;
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
    timerSetup(timerPrefs.defaultSeconds);
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
    if (timer.running) timerPause();
    modalAnswer.classList.add('visible');
    btnReveal.style.display = 'none';
    awardSection.classList.remove('hidden');
  });

  function awardPoints(teamIdx) {
    if (!activeClue) return;
    // Goes to the shared leaderboard (by team id); onChange above updates `teams`.
    ShowerSession.addPoints(teams[teamIdx].id, activeClue.value);
    closeClue();
  }

  btnNoOne.addEventListener('click', () => closeClue());

  function closeClue() {
    if (activeClue) {
      usedClues.add(`${activeClue.catIdx}-${activeClue.clueIdx}`);
    }
    activeClue = null;
    timerStop();
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

  // ---------- Question timer ----------
  // The board header sets the DEFAULT length (remembered on this device);
  // each question card starts at that default and can be nudged ±5s for
  // just that question. The host starts it manually; revealing the answer
  // pauses it; closing the card stops it.
  const TIMER_MIN = 5, TIMER_MAX = 300, TIMER_STEP = 5;
  const PREFS_KEY = 'jeopardyTimerPrefs_v1';
  const timerPrefs = loadTimerPrefs();
  const timer = { duration: 30, remainingMs: 30000, endAt: 0, running: false, done: false, interval: null };
  let audioCtx = null;

  function loadTimerPrefs() {
    const prefs = { defaultSeconds: 30, sound: true };
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (Number.isFinite(saved.defaultSeconds)) prefs.defaultSeconds = clampSeconds(saved.defaultSeconds);
      if (typeof saved.sound === 'boolean') prefs.sound = saved.sound;
    } catch (e) { /* storage blocked — defaults are fine */ }
    return prefs;
  }
  function saveTimerPrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(timerPrefs)); } catch (e) { /* ignore */ }
  }
  function clampSeconds(n) { return Math.min(TIMER_MAX, Math.max(TIMER_MIN, Math.round(n))); }

  function renderTimerSetting() {
    defaultTimerLabel.textContent = formatSeconds(timerPrefs.defaultSeconds);
    btnDefaultMinus.disabled = timerPrefs.defaultSeconds <= TIMER_MIN;
    btnDefaultPlus.disabled = timerPrefs.defaultSeconds >= TIMER_MAX;
    btnSound.textContent = timerPrefs.sound ? '🔔' : '🔕';
    btnSound.setAttribute('aria-label', timerPrefs.sound ? 'Mute time\'s-up sound' : 'Unmute time\'s-up sound');
  }
  function formatSeconds(n) { return n < 60 ? `${n}s` : `${Math.floor(n / 60)}m${n % 60 ? ` ${n % 60}s` : ''}`; }

  btnDefaultMinus.addEventListener('click', () => changeDefault(-TIMER_STEP));
  btnDefaultPlus.addEventListener('click', () => changeDefault(TIMER_STEP));
  function changeDefault(delta) {
    timerPrefs.defaultSeconds = clampSeconds(timerPrefs.defaultSeconds + delta);
    saveTimerPrefs();
    renderTimerSetting();
  }
  btnSound.addEventListener('click', () => {
    timerPrefs.sound = !timerPrefs.sound;
    saveTimerPrefs();
    renderTimerSetting();
  });
  renderTimerSetting();

  function timerSetup(seconds) {
    timerStop();
    timer.duration = clampSeconds(seconds);
    timer.remainingMs = timer.duration * 1000;
    timer.done = false;
    modalCard.classList.remove('times-up-flash');
    renderTimer();
  }

  function timerStart() {
    if (timer.done || timer.remainingMs <= 0) timerSetup(timer.duration);
    unlockAudio();
    timer.endAt = performance.now() + timer.remainingMs;
    timer.running = true;
    timer.interval = setInterval(timerTick, 100);
    renderTimer();
  }

  function timerPause() {
    if (!timer.running) return;
    timer.remainingMs = Math.max(0, timer.endAt - performance.now());
    timer.running = false;
    clearInterval(timer.interval);
    renderTimer();
  }

  function timerStop() {
    timer.running = false;
    clearInterval(timer.interval);
  }

  function timerTick() {
    timer.remainingMs = Math.max(0, timer.endAt - performance.now());
    if (timer.remainingMs <= 0) return timerFinish();
    renderTimer();
  }

  function timerFinish() {
    timerStop();
    timer.remainingMs = 0;
    timer.done = true;
    renderTimer();
    // Restart the flash animation even if it ran on a previous question.
    modalCard.classList.remove('times-up-flash');
    void modalCard.offsetWidth;
    modalCard.classList.add('times-up-flash');
    if (timerPrefs.sound) playChime();
  }

  // ±5s on THIS question only. While running it adds/removes time live.
  function timerAdjust(delta) {
    const newDuration = clampSeconds(timer.duration + delta);
    const applied = newDuration - timer.duration;
    if (!applied && !timer.done) return;
    timer.duration = newDuration;
    if (timer.done) return timerSetup(newDuration);
    if (timer.running) {
      timer.endAt = Math.max(performance.now() + 1000, timer.endAt + applied * 1000);
      timer.remainingMs = timer.endAt - performance.now();
    } else {
      timer.remainingMs = Math.max(1000, Math.min(timer.duration * 1000, timer.remainingMs + applied * 1000));
    }
    renderTimer();
  }

  function renderTimer() {
    const secs = Math.ceil(timer.remainingMs / 1000);
    timerDisplay.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const fraction = timer.duration ? timer.remainingMs / (timer.duration * 1000) : 0;
    timerFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;

    const started = timer.remainingMs < timer.duration * 1000;
    qTimer.classList.toggle('warning', !timer.done && started && timer.remainingMs <= 5000);
    qTimer.classList.toggle('paused', !timer.running && started && !timer.done);
    qTimer.classList.toggle('done', timer.done);
    timesUpEl.textContent = timer.done ? '⏰ TIME\'S UP!' : '';

    btnTimerStart.textContent = timer.running ? '⏸ Pause'
      : timer.done ? '▶ Restart'
      : started ? '▶ Resume'
      : '▶ Start timer';
    btnTimerMinus.disabled = timer.duration <= TIMER_MIN;
    btnTimerPlus.disabled = timer.duration >= TIMER_MAX;
  }

  btnTimerStart.addEventListener('click', () => (timer.running ? timerPause() : timerStart()));
  btnTimerReset.addEventListener('click', () => timerSetup(timer.duration));
  btnTimerMinus.addEventListener('click', () => timerAdjust(-TIMER_STEP));
  btnTimerPlus.addEventListener('click', () => timerAdjust(TIMER_STEP));

  // Browsers only allow sound after a click, so the audio context is
  // created when the host presses Start.
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }

  // Three quick rising "ding"s.
  function playChime() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [660, 880, 1100].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

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
