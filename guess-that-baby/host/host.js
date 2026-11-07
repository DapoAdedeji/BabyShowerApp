// ============================================================
// GUESS THAT BABY — host (admin) view
// ============================================================
// Live team status, round controls (close / reopen / reveal / restart),
// releasing a team's phone, a full-screen reveal show for the TV, and
// adding the points to the Leaderboard (once per round).
// Server API: /api/gtb/* in ../../worker/index.js.
// ============================================================
(function () {
  const POLL_MS = 4000;
  const $ = id => document.getElementById(id);

  let data = null;     // last /api/gtb/admin response
  let busy = false;    // an action is in flight

  // ---------- API ----------
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { location.href = '/welcome/?next=/guess-that-baby/host/'; throw new Error('signed out'); }
    let json = {};
    try { json = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(json.error || 'Something went wrong — try again.');
    return json;
  }

  function showError(msg) {
    const el = $('host-error');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  async function refresh() {
    try {
      data = await api('GET', '/api/gtb/admin');
      showError('');
      render();
    } catch (e) {
      if (e.message !== 'signed out') showError(`Couldn't load the game: ${e.message}`);
    }
  }

  async function action(fn) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('#status-actions button, .team-release, #btn-restart').forEach(b => { b.disabled = true; });
    try {
      await fn();
      showError('');
    } catch (e) {
      if (e.message !== 'signed out') showError(e.message);
    } finally {
      busy = false;
      $('btn-restart').disabled = false; // the only button that isn't redrawn
      await refresh();
    }
  }

  // ---------- Render ----------
  function render() {
    const hasTeams = data.teams.length > 0;
    $('no-teams').hidden = hasTeams;
    $('host-main').hidden = !hasTeams;
    if (!hasTeams) return;

    renderStatus();
    renderTeams();
    if (!$('show').hidden) renderShow(); // keep guesses fresh during the show
  }

  function renderStatus() {
    const total = data.config.photos.length;
    const joined = data.teams.filter(t => t.claimed).length;
    const pill = $('status-pill');
    const help = $('status-help');
    const actions = $('status-actions');
    actions.innerHTML = '';
    pill.className = 'status-pill';
    $('demo-note').hidden = !data.demo;

    if (data.status === 'open') {
      pill.textContent = '🟢 Round open';
      help.textContent = `Phones are answering — ${joined} of ${data.teams.length} teams have joined. Close the round when time's up.`;
      actions.append(btn('🔒 Close round', 'btn-primary', () => {
        const unfinished = data.teams.filter(t => t.answered < total).map(t => t.name);
        const warn = unfinished.length ? `\n\nStill answering: ${unfinished.join(', ')}.` : '';
        if (confirm(`Close the round? Every phone's answers will lock.${warn}`)) action(() => api('POST', '/api/gtb/close'));
      }));
    } else if (data.status === 'closed') {
      pill.classList.add('closed');
      pill.textContent = '🔒 Round closed';
      help.textContent = 'Answers are locked. Reveal when you\'re ready — every phone will show its score at the same moment.';
      actions.append(
        btn('↩ Reopen', 'btn-ghost btn-small', () => action(() => api('POST', '/api/gtb/open'))),
        btn('🎉 Reveal answers', 'btn-primary', () => {
          if (confirm('Reveal the answers on every phone now?')) action(() => api('POST', '/api/gtb/reveal'));
        })
      );
    } else {
      pill.classList.add('revealed');
      pill.textContent = '🎉 Answers revealed';
      help.textContent = data.awarded
        ? 'Points are on the Leaderboard. Run the reveal show on the TV any time.'
        : `Run the reveal show on the TV, then add the points (${data.pointsPerCorrect} per correct answer).`;
      actions.append(btn('▶ Reveal show', 'btn-ghost', openShow));
      if (data.awarded) {
        const tag = document.createElement('span');
        tag.className = 'awarded-tag';
        tag.textContent = '✓ Points added';
        actions.append(tag);
      } else {
        actions.append(btn('🏆 Add points to Leaderboard', 'btn-primary', awardPoints));
      }
    }
  }

  function renderTeams() {
    const total = data.config.photos.length;
    const revealed = data.status === 'revealed';
    const joined = data.teams.filter(t => t.claimed).length;
    $('teams-summary').textContent = `${joined} of ${data.teams.length} phones joined`;

    const rows = $('team-rows');
    rows.innerHTML = '';
    data.teams.forEach(team => {
      const row = document.createElement('div');
      row.className = 'team-row';
      row.style.borderLeftColor = team.color;

      const dot = document.createElement('span');
      dot.className = 'team-dot';
      dot.style.background = team.color;

      const name = document.createElement('div');
      name.className = 'team-name';
      name.textContent = team.name;
      const phone = document.createElement('span');
      phone.className = 'team-phone' + (team.claimed ? ' on' : '');
      phone.textContent = team.claimed ? '📱 Phone joined' : 'Waiting for a phone…';
      name.appendChild(phone);

      const progress = document.createElement('div');
      progress.className = 'team-progress';
      const ptext = document.createElement('span');
      ptext.className = 'team-progress-text';
      ptext.textContent = `${team.answered} / ${total} answered`;
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${Math.round((team.answered / total) * 100)}%`;
      bar.appendChild(fill);
      progress.append(ptext, bar);

      const score = document.createElement('span');
      score.className = 'team-score';
      score.textContent = revealed ? `${team.correct} right · +${(team.correct * data.pointsPerCorrect).toLocaleString()}` : '';

      const release = document.createElement('button');
      release.type = 'button';
      release.className = 'btn-ghost btn-small team-release';
      release.textContent = 'Release phone';
      release.hidden = !team.claimed;
      release.addEventListener('click', () => {
        if (confirm(`Release ${team.name}'s phone? Their answers are kept, and the next phone to pick ${team.name} carries on.`)) {
          action(() => api('POST', '/api/gtb/release', { team: team.id }));
        }
      });

      row.append(dot, name, progress, score, release);
      rows.appendChild(row);
    });
  }

  function btn(text, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------- Restart ----------
  $('btn-restart').addEventListener('click', () => {
    if (!confirm('Restart Guess That Baby?\n\nEvery phone is released and ALL answers are cleared. (Points already added to the Leaderboard stay.)')) return;
    action(() => api('POST', '/api/gtb/reset'));
  });

  // ---------- Points ----------
  // The server adds the points straight to the shared Leaderboard (by team
  // id), so this works from any admin device and can't run twice.
  async function awardPoints() {
    const lines = data.teams.map(t => `${t.name}: ${t.correct} right → +${(t.correct * data.pointsPerCorrect).toLocaleString()}`);
    if (!confirm(`Add these points to the Leaderboard?\n\n${lines.join('\n')}\n\nThis can only be done once per round.`)) return;
    await action(async () => {
      await api('POST', '/api/gtb/award');
      if (window.ShowerSession) ShowerSession.refresh();
    });
  }

  // ---------- Reveal show ----------
  const show = { index: 0, revealed: false, results: false };

  function openShow() {
    show.index = 0;
    show.revealed = false;
    show.results = false;
    $('show').hidden = false;
    renderShow();
  }
  function closeShow() { $('show').hidden = true; }

  function renderShow() {
    const photos = data.config.photos;
    const total = photos.length;
    $('show-photo-view').hidden = show.results;
    $('show-results').hidden = !show.results;
    $('show-prev').disabled = show.index === 0 && !show.results;

    if (show.results) {
      $('show-count').textContent = 'Results';
      $('show-next').textContent = 'Finish ✓';
      renderResults();
      return;
    }

    const photo = photos[show.index];
    const answer = data.config.key[photo.n];
    $('show-count').textContent = `Baby ${show.index + 1} of ${total}`;
    $('show-img').src = photo.img;
    $('show-img').alt = `Baby photo number ${photo.n}`;
    $('show-label').textContent = `Baby #${photo.n} is…`;
    $('show-name').textContent = show.revealed ? answer : '';
    $('show-reveal').hidden = show.revealed;
    $('show-next').textContent = show.index === total - 1 ? 'See results 🏆' : 'Next ›';

    const list = $('show-guesses');
    list.innerHTML = '';
    if (show.revealed) {
      data.teams.forEach(t => {
        const guess = t.answers[photo.n];
        const right = guess && guess === answer;
        const li = document.createElement('li');
        li.style.borderLeftColor = t.color;
        const team = document.createElement('span');
        team.className = 'g-team';
        team.textContent = t.name;
        const g = document.createElement('span');
        g.className = 'g-guess';
        g.textContent = guess || 'no answer';
        const mark = document.createElement('span');
        mark.className = 'g-mark';
        mark.textContent = right ? '✅' : '❌';
        li.append(team, g, mark);
        list.appendChild(li);
      });
    }
  }

  function renderResults() {
    const list = $('results-list');
    list.innerHTML = '';
    const sorted = [...data.teams].sort((a, b) => b.correct - a.correct);
    const best = sorted.length ? sorted[0].correct : 0;
    sorted.forEach(t => {
      const li = document.createElement('li');
      li.className = t.correct === best && best > 0 ? 'winner' : '';
      li.style.borderLeftColor = t.color;
      const name = document.createElement('span');
      name.className = 'r-name';
      name.textContent = `${t.correct === best && best > 0 ? '👑 ' : ''}${t.name}`;
      const score = document.createElement('span');
      score.className = 'r-score';
      score.textContent = `${t.correct} / ${data.config.photos.length}`;
      const pts = document.createElement('span');
      pts.className = 'r-points';
      pts.textContent = `+${(t.correct * data.pointsPerCorrect).toLocaleString()}`;
      li.append(name, score, pts);
      list.appendChild(li);
    });
  }

  function showNext() {
    if (show.results) return closeShow();
    if (!show.revealed) { show.revealed = true; return renderShow(); }
    if (show.index < data.config.photos.length - 1) {
      show.index++;
      show.revealed = false;
    } else {
      show.results = true;
    }
    renderShow();
  }
  function showPrev() {
    if (show.results) { show.results = false; show.revealed = true; return renderShow(); }
    if (show.index > 0) { show.index--; show.revealed = true; renderShow(); }
  }

  $('show-reveal').addEventListener('click', () => { show.revealed = true; renderShow(); });
  $('show-next').addEventListener('click', showNext);
  $('show-prev').addEventListener('click', showPrev);
  $('show-exit').addEventListener('click', closeShow);
  document.addEventListener('keydown', (e) => {
    if ($('show').hidden) return;
    if (e.key === 'Escape') return closeShow();
    // Space/Enter on a focused button already "clicks" it — don't step twice.
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button')) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); showNext(); }
    else if (e.key === 'ArrowLeft') showPrev();
  });

  // ---------- Go ----------
  refresh();
  setInterval(() => { if (!document.hidden && !busy) refresh(); }, POLL_MS);
})();
