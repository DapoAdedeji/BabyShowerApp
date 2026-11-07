// ============================================================
// GUESS THAT BABY — the guest (phone) game
// ============================================================
// 1. Needs the Leaderboard's teams; one phone claims each team.
// 2. Match every numbered baby photo to a name (each name once).
// 3. Answers save to the server as you go. The host closes the round
//    (answers lock) and then reveals the answers from the admin side.
// Server API: /api/gtb/* in ../worker/index.js.
// ============================================================
(function () {
  const CLAIM_KEY = 'gtbClaim_v1';   // { round, team, token } on this phone
  const POLL_MS = 8000;
  const SAVE_DELAY_MS = 700;

  const $ = id => document.getElementById(id);
  const screens = ['screen-loading', 'screen-message', 'screen-team', 'screen-game'].map($);

  let state = null;       // last /api/gtb/state response
  let claim = loadClaim();
  let answers = {};       // { "1": "Name" } — this phone's working copy
  let current = 1;        // photo number on screen
  let pendingSave = false;
  let saveTimer = null;
  let saving = false;
  let lastNotice = '';

  // ---------- Small helpers ----------
  function show(id) {
    screens.forEach(s => s.classList.toggle('active', s.id === id));
  }
  function loadClaim() {
    try { return JSON.parse(localStorage.getItem(CLAIM_KEY)) || null; } catch (e) { return null; }
  }
  function storeClaim(c) {
    claim = c;
    try { c ? localStorage.setItem(CLAIM_KEY, JSON.stringify(c)) : localStorage.removeItem(CLAIM_KEY); } catch (e) { /* in-memory only */ }
  }
  function headers(extra) {
    const h = { ...(extra || {}) };
    if (claim) {
      h['X-GTB-Team'] = encodeURIComponent(claim.team);
      h['X-GTB-Token'] = claim.token;
    }
    return h;
  }
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers(body ? { 'Content-Type': 'application/json' } : null),
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { location.href = '/welcome/?next=/guess-that-baby/'; throw new Error('signed out'); }
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    return { ok: res.ok, status: res.status, data };
  }
  function message(icon, title, text) {
    $('message-icon').textContent = icon;
    $('message-title').textContent = title;
    $('message-text').textContent = text;
    show('screen-message');
  }
  function photoNumbers() { return state.photos.map(p => p.n); }

  // ---------- Load / poll ----------
  async function refresh() {
    let res;
    try {
      res = await api('GET', '/api/gtb/state');
    } catch (e) {
      if (!state) message('📶', 'Can\'t connect', 'Check your internet connection — we\'ll keep trying.');
      return;
    }
    if (!res.ok) {
      if (!state) message('😕', 'Something went wrong', res.data.error || 'Please try again in a moment.');
      return;
    }
    const prev = state;
    state = res.data;

    // We think we own a team, but the server disagrees -> released or restarted.
    if (claim && !state.myTeam) {
      lastNotice = claim.round !== state.round
        ? 'The host restarted the game — pick your team again.'
        : 'This phone was released from its team by the host. Pick your team again.';
      storeClaim(null);
      answers = {};
    }

    if (!state.teams.length) {
      return message('🏆', 'Hang tight!', 'The host needs to set up the teams on the Leaderboard before this game can start.');
    }

    if (!state.myTeam) return renderTeamPicker();

    // Keep local edits that haven't reached the server yet.
    if (!pendingSave && !saving) answers = { ...state.answers };
    const firstShow = !prev || !prev.myTeam;
    if (firstShow) current = firstUnanswered();
    // Don't redraw under someone mid-pick (it can close the dropdown on
    // phones) unless something important changed, like the round closing.
    const picking = document.activeElement === $('name-select');
    if (picking && prev && prev.status === state.status) return;
    renderGame(firstShow);
  }

  function firstUnanswered() {
    const n = photoNumbers().find(n => !answers[n]);
    return n || photoNumbers()[0];
  }

  // ---------- Team picker ----------
  function renderTeamPicker() {
    const notice = $('team-notice');
    notice.textContent = lastNotice;
    notice.hidden = !lastNotice;

    const list = $('team-list');
    list.innerHTML = '';
    const open = state.teams.filter(t => !t.claimed);

    if (state.status !== 'open') {
      list.innerHTML = '<p class="gtb-empty">This round is closed. Wait for the host to start a new one.</p>';
    } else if (!open.length) {
      list.innerHTML = '<p class="gtb-empty">Every team already has a phone. If yours stopped working, ask the host to release your team.</p>';
    }
    if (state.status === 'open') {
      open.forEach(team => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gtb-team-btn';
        btn.style.borderColor = team.color;
        const dot = document.createElement('span');
        dot.className = 'gtb-dot';
        dot.style.background = team.color;
        const name = document.createElement('span');
        name.textContent = team.name;
        const go = document.createElement('span');
        go.className = 'gtb-go';
        go.textContent = '→';
        btn.append(dot, name, go);
        btn.addEventListener('click', () => claimTeam(team.name));
        list.appendChild(btn);
      });
    }
    show('screen-team');
  }

  async function claimTeam(team) {
    if (!confirm(`Join as "${team}"? This phone will be locked to that team.`)) return;
    $('team-error').textContent = '';
    $('team-list').querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const res = await api('POST', '/api/gtb/claim', { team });
      if (!res.ok) throw new Error(res.data.error || 'Couldn\'t join that team.');
      storeClaim({ round: state.round, team: res.data.team, token: res.data.token });
      lastNotice = '';
      await refresh();
    } catch (e) {
      $('team-error').textContent = e.message;
      await refresh();
    }
  }

  // ---------- Game ----------
  function renderGame(scrollTracker) {
    const myTeam = state.teams.find(t => t.name === state.myTeam) || {};
    $('my-team-name').textContent = state.myTeam;
    $('my-team-dot').style.background = myTeam.color || '';
    const total = state.photos.length;
    const done = Object.keys(answers).length;
    $('progress').textContent = `${done}/${total}`;

    const banner = $('status-banner');
    banner.className = 'gtb-banner';
    banner.innerHTML = '';
    if (state.status === 'closed') {
      banner.classList.add('closed');
      banner.textContent = '🔒 Answers are locked! Waiting for the host to reveal… 🥁';
      banner.hidden = false;
    } else if (state.status === 'revealed') {
      banner.classList.add('revealed');
      const score = document.createElement('span');
      score.className = 'gtb-score';
      score.textContent = `${state.score} / ${total} right!`;
      banner.append(score, state.score === total ? '🏆 Perfect score!' : '🎉 Here are the answers');
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }

    renderPhoto();
    renderTracker(scrollTracker);
    show('screen-game');
  }

  function renderPhoto() {
    const photo = state.photos.find(p => p.n === current) || state.photos[0];
    current = photo.n;
    $('photo').src = photo.img;
    $('photo').alt = `Baby photo number ${photo.n}`;
    $('photo-label').textContent = `Baby #${photo.n}`;

    const locked = state.status !== 'open';
    const select = $('name-select');
    const mine = answers[current] || '';
    // Which photo has each name, so it can't be picked twice.
    const usedOn = {};
    Object.entries(answers).forEach(([n, name]) => { usedOn[name] = n; });

    select.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = locked ? '— No answer —' : '— Choose a name —';
    select.appendChild(blank);
    state.names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      const elsewhere = usedOn[name] && usedOn[name] !== String(current);
      opt.textContent = elsewhere ? `${name} (used on #${usedOn[name]})` : name;
      opt.disabled = !!elsewhere;
      select.appendChild(opt);
    });
    select.value = mine;
    select.disabled = locked;
    select.classList.toggle('empty', !mine);
    $('select-label').textContent = locked ? 'Your answer' : 'Who is this baby?';

    const reveal = $('reveal-line');
    if (state.status === 'revealed' && state.key) {
      const right = state.key[current];
      const ok = mine && mine === right;
      reveal.className = 'gtb-reveal-line ' + (ok ? 'right' : 'wrong');
      reveal.textContent = ok ? `✅ Correct — it's ${right}!` : `❌ It's ${right}`;
      reveal.hidden = false;
    } else {
      reveal.hidden = true;
    }

    const nums = photoNumbers();
    const idx = nums.indexOf(current);
    $('btn-prev').disabled = idx <= 0;
    $('btn-next').disabled = idx >= nums.length - 1;
  }

  function renderTracker(scrollToCurrent) {
    const tracker = $('tracker');
    tracker.innerHTML = '';
    const revealed = state.status === 'revealed' && state.key;
    state.photos.forEach(p => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'gtb-chip';
      chip.textContent = p.n;
      const a = answers[p.n];
      if (revealed) chip.classList.add(a && a === state.key[p.n] ? 'right' : 'wrong');
      else if (a) chip.classList.add('answered');
      if (p.n === current) {
        chip.classList.add('current');
        chip.setAttribute('aria-current', 'true');
      }
      chip.setAttribute('aria-label', `Baby ${p.n}${a ? `, answered ${a}` : ', not answered'}`);
      chip.addEventListener('click', () => goTo(p.n));
      tracker.appendChild(chip);
    });
    const cur = tracker.querySelector('.current');
    if (cur && scrollToCurrent) {
      tracker.scrollTo({ left: cur.offsetLeft - tracker.clientWidth / 2 + cur.clientWidth / 2, behavior: 'smooth' });
    }
  }

  function goTo(n) {
    current = n;
    renderPhoto();
    renderTracker(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function step(dir) {
    const nums = photoNumbers();
    const next = nums[nums.indexOf(current) + dir];
    if (next !== undefined) goTo(next);
  }

  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));

  $('name-select').addEventListener('change', (e) => {
    if (state.status !== 'open') return;
    const name = e.target.value;
    if (name) answers[current] = name; else delete answers[current];
    renderGame();
    queueSave();
    // Picked a name? Move on to the next unanswered baby after a beat.
    if (name) {
      const nums = photoNumbers();
      const after = nums.slice(nums.indexOf(current) + 1).concat(nums).find(n => !answers[n]);
      if (after !== undefined) setTimeout(() => goTo(after), 450);
    }
  });

  // Swipe left/right on the photo to change baby.
  let touchX = null;
  let swiped = false;
  $('photo-btn').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  $('photo-btn').addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) { swiped = true; step(dx < 0 ? 1 : -1); }
  });

  // ---------- Zoom ----------
  $('photo-btn').addEventListener('click', () => {
    if (swiped) { swiped = false; return; }
    $('zoom-img').src = $('photo').src;
    $('zoom-img').alt = $('photo').alt;
    $('zoom').hidden = false;
  });
  function closeZoom() { $('zoom').hidden = true; }
  $('zoom-close').addEventListener('click', closeZoom);
  $('zoom').addEventListener('click', e => { if (e.target.id === 'zoom') closeZoom(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeZoom();
    if (!$('zoom').hidden || document.activeElement === $('name-select')) return;
    if ($('screen-game').classList.contains('active')) {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    }
  });

  // ---------- Saving ----------
  function setSaveStatus(text, isError) {
    const el = $('save-status');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  function queueSave() {
    pendingSave = true;
    setSaveStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
  }

  async function saveNow() {
    if (saving) { saveTimer = setTimeout(saveNow, 300); return; }
    saving = true;
    pendingSave = false;
    try {
      const res = await api('PUT', '/api/gtb/answers', { answers });
      if (res.ok) {
        setSaveStatus('Saved ✓');
      } else if (res.status === 429) {
        pendingSave = true;
        saveTimer = setTimeout(saveNow, 1200);
      } else if (res.status === 409) {
        setSaveStatus('Round closed — last change not saved', true);
        await refresh();
      } else if (res.status === 403) {
        await refresh();
      } else {
        throw new Error(res.data.error);
      }
    } catch (e) {
      if (e.message === 'signed out') return;
      pendingSave = true;
      setSaveStatus('Not saved — retrying…', true);
      saveTimer = setTimeout(saveNow, 3000);
    } finally {
      saving = false;
    }
  }

  // ---------- Go ----------
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
