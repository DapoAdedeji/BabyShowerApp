// ============================================================
// JEOPARDY QUESTION EDITOR
// Password-protected editor for categories, clues and answers.
// Saves to Cloudflare KV through the Worker API (see ../worker/index.js);
// the game picks the saved set up on its next load. questions.js stays
// the built-in fallback / starting point.
// ============================================================

(function () {
  const LIMITS = { categories: 12, cluesPerCategory: 10 };
  const PW_KEY = 'jeopardyAdminPw';

  const screenLogin = document.getElementById('screen-login');
  const screenEditor = document.getElementById('screen-editor');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('login-error');
  const btnLogin = document.getElementById('btn-login');

  const saveStatus = document.getElementById('save-status');
  const btnSave = document.getElementById('btn-save');
  const btnLock = document.getElementById('btn-lock');
  const editorError = document.getElementById('editor-error');
  const sourceNote = document.getElementById('source-note');
  const titleInput = document.getElementById('game-title');
  const subtitleInput = document.getElementById('game-subtitle');
  const categoriesEl = document.getElementById('categories');
  const categoryCount = document.getElementById('category-count');
  const btnAddCategory = document.getElementById('btn-add-category');
  const btnReset = document.getElementById('btn-reset');

  let password = '';
  let state = null;          // { title, subtitle, categories: [{ title, clues: [{ value, clue, answer }] }] }
  let openCats = new Set();  // indexes of expanded category cards
  let dirty = false;
  let saving = false;

  // ---------- Helpers ----------
  function show(screen) {
    [screenLogin, screenEditor].forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
  }
  function storeGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function storeDel(k) { try { sessionStorage.removeItem(k); } catch (e) { /* private mode */ } }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function defaults() {
    const d = window.GAME_DATA || {};
    return {
      title: d.title || '',
      subtitle: d.subtitle || '',
      categories: clone(d.categories || [])
    };
  }

  async function api(method, path, body) {
    const opts = { method, headers: {}, cache: 'no-store' };
    if (password) opts.headers.Authorization = `Bearer ${password}`;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      throw new Error('Couldn\'t reach the server. Check your connection and try again.');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON, e.g. a static host with no API */ }
    if (!data && !res.ok) {
      const err = new Error('The editor API isn\'t available here. It only works on the Cloudflare site (or `npx wrangler dev` locally).');
      err.status = res.status;
      throw err;
    }
    return { status: res.status, ok: res.ok, data: data || {} };
  }

  // ---------- Login ----------
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await tryLogin(passwordInput.value);
  });

  async function tryLogin(pw) {
    loginError.textContent = '';
    btnLogin.disabled = true;
    btnLogin.textContent = 'Checking…';
    password = pw;
    try {
      const res = await api('POST', '/api/admin/login');
      if (!res.ok) throw new Error(res.data.error || 'Couldn\'t log in.');
      storeSet(PW_KEY, pw);
      passwordInput.value = '';
      await openEditor();
    } catch (err) {
      password = '';
      storeDel(PW_KEY);
      loginError.textContent = err.message;
      show(screenLogin);
      passwordInput.focus();
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Unlock ✨';
    }
  }

  btnLock.addEventListener('click', () => {
    if (dirty && !confirm('You have unsaved changes. Lock the editor and lose them?')) return;
    password = '';
    storeDel(PW_KEY);
    dirty = false;
    state = null;
    show(screenLogin);
  });

  // ---------- Load ----------
  async function openEditor() {
    const res = await api('GET', '/api/questions');
    if (res.ok && res.data && Array.isArray(res.data.categories)) {
      state = {
        title: res.data.title || '',
        subtitle: res.data.subtitle || '',
        categories: res.data.categories
      };
      sourceNote.textContent = '';
      setStatus(res.data.updatedAt ? `Last saved ${formatTime(res.data.updatedAt)}` : 'All changes saved', 'saved');
    } else if (res.status === 404) {
      state = defaults();
      sourceNote.textContent = 'You\'re looking at the built-in questions from questions.js. Edit anything and hit Save to start your own set.';
      setStatus('Built-in questions', '');
    } else {
      throw new Error(res.data.error || 'Couldn\'t load the questions.');
    }
    dirty = false;
    openCats = new Set();
    editorError.textContent = '';
    render();
    show(screenEditor);
  }

  // ---------- Render ----------
  function render() {
    titleInput.value = state.title;
    subtitleInput.value = state.subtitle;
    categoriesEl.innerHTML = '';
    state.categories.forEach((cat, ci) => categoriesEl.appendChild(renderCategory(cat, ci)));
    const n = state.categories.length;
    categoryCount.textContent = `${n} ${n === 1 ? 'category' : 'categories'}${n === 6 ? ' — classic board size' : ''}`;
    btnAddCategory.disabled = n >= LIMITS.categories;
    updateSaveButton();
  }

  function renderCategory(cat, ci) {
    const card = document.createElement('section');
    card.className = 'editor-card cat-card' + (openCats.has(ci) ? ' open' : '');

    const head = document.createElement('div');
    head.className = 'cat-head';

    const toggle = button(openCats.has(ci) ? '▼' : '▶', 'cat-toggle', `Show or hide clues for category ${ci + 1}`, () => {
      openCats.has(ci) ? openCats.delete(ci) : openCats.add(ci);
      const open = card.classList.toggle('open');
      toggle.textContent = open ? '▼' : '▶';
      toggle.setAttribute('aria-expanded', String(open));
    });
    toggle.setAttribute('aria-expanded', String(openCats.has(ci)));

    const title = document.createElement('input');
    title.className = 'text-input';
    title.type = 'text';
    title.maxLength = 120;
    title.placeholder = `Category ${ci + 1} title`;
    title.value = cat.title;
    title.setAttribute('aria-label', `Category ${ci + 1} title`);
    title.dataset.field = `cat-${ci}-title`;
    title.addEventListener('input', () => { cat.title = title.value; markDirty(title); });

    const meta = document.createElement('span');
    meta.className = 'cat-meta muted';
    meta.textContent = `${cat.clues.length} clue${cat.clues.length === 1 ? '' : 's'}`;

    const up = button('↑', 'icon-btn', 'Move category up', () => moveCategory(ci, -1));
    up.disabled = ci === 0;
    const down = button('↓', 'icon-btn', 'Move category down', () => moveCategory(ci, 1));
    down.disabled = ci === state.categories.length - 1;
    const del = button('🗑', 'icon-btn danger', 'Delete category', () => {
      if (state.categories.length <= 1) return alert('The game needs at least one category.');
      if (!confirm(`Delete the "${cat.title || 'untitled'}" category and all its clues?`)) return;
      state.categories.splice(ci, 1);
      openCats = shiftSet(openCats, ci);
      changed();
    });

    head.append(toggle, title, meta, up, down, del);

    const body = document.createElement('div');
    body.className = 'cat-body';
    cat.clues.forEach((clue, qi) => body.appendChild(renderClue(cat, ci, clue, qi)));

    const addClue = document.createElement('button');
    addClue.type = 'button';
    addClue.className = 'btn-add';
    addClue.textContent = '＋ Add clue';
    addClue.disabled = cat.clues.length >= LIMITS.cluesPerCategory;
    addClue.addEventListener('click', () => {
      const last = cat.clues[cat.clues.length - 1];
      cat.clues.push({ value: last ? Number(last.value) + 100 : 100, clue: '', answer: '' });
      openCats.add(ci);
      changed();
      focusField(`cat-${ci}-clue-${cat.clues.length - 1}-clue`);
    });
    body.appendChild(addClue);

    card.append(head, body);
    return card;
  }

  function renderClue(cat, ci, clue, qi) {
    const row = document.createElement('div');
    row.className = 'clue-row';
    const id = `c${ci}q${qi}`;
    const base = `cat-${ci}-clue-${qi}`;

    const valueWrap = fieldWrap('clue-value', 'Points', `${id}-v`);
    const value = document.createElement('input');
    value.className = 'text-input';
    value.type = 'number';
    value.inputMode = 'numeric';
    value.min = '1';
    value.step = '100';
    value.id = `${id}-v`;
    value.value = clue.value;
    value.dataset.field = `${base}-value`;
    value.addEventListener('input', () => { clue.value = value.value === '' ? '' : Number(value.value); markDirty(value); });
    valueWrap.appendChild(value);

    const clueWrap = fieldWrap('clue-text', 'Clue (read aloud first)', `${id}-c`);
    const clueText = textArea(`${id}-c`, clue.clue, 'e.g. The name for a baby kangaroo.');
    clueText.dataset.field = `${base}-clue`;
    clueText.addEventListener('input', () => { clue.clue = clueText.value; markDirty(clueText); });
    clueWrap.appendChild(clueText);

    const answerWrap = fieldWrap('clue-answer', 'Answer (revealed after)', `${id}-a`);
    const answer = textArea(`${id}-a`, clue.answer, 'e.g. What is a joey?');
    answer.dataset.field = `${base}-answer`;
    answer.addEventListener('input', () => { clue.answer = answer.value; markDirty(answer); });
    answerWrap.appendChild(answer);

    const actions = document.createElement('div');
    actions.className = 'clue-actions';
    const up = button('↑', 'icon-btn', 'Move clue up', () => moveClue(cat, qi, -1));
    up.disabled = qi === 0;
    const down = button('↓', 'icon-btn', 'Move clue down', () => moveClue(cat, qi, 1));
    down.disabled = qi === cat.clues.length - 1;
    const del = button('🗑', 'icon-btn danger', 'Delete clue', () => {
      if (cat.clues.length <= 1) return alert('Each category needs at least one clue.');
      if ((clue.clue || clue.answer) && !confirm('Delete this clue?')) return;
      cat.clues.splice(qi, 1);
      changed();
    });
    actions.append(up, down, del);

    row.append(valueWrap, clueWrap, answerWrap, actions);
    return row;
  }

  function fieldWrap(cls, label, forId) {
    const wrap = document.createElement('div');
    wrap.className = cls;
    const l = document.createElement('label');
    l.className = 'field-label';
    l.htmlFor = forId;
    l.textContent = label;
    wrap.appendChild(l);
    return wrap;
  }

  function textArea(id, value, placeholder) {
    const t = document.createElement('textarea');
    t.className = 'text-area';
    t.id = id;
    t.rows = 2;
    t.maxLength = 600;
    t.placeholder = placeholder;
    t.value = value || '';
    return t;
  }

  function button(text, cls, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  function focusField(name) {
    const el = categoriesEl.querySelector(`[data-field="${name}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); }
  }

  // ---------- Edits ----------
  titleInput.addEventListener('input', () => { state.title = titleInput.value; markDirty(titleInput); });
  subtitleInput.addEventListener('input', () => { state.subtitle = subtitleInput.value; markDirty(subtitleInput); });

  btnAddCategory.addEventListener('click', () => {
    if (state.categories.length >= LIMITS.categories) return;
    state.categories.push({
      title: '',
      clues: [100, 200, 300, 400, 500].map(value => ({ value, clue: '', answer: '' }))
    });
    const ci = state.categories.length - 1;
    openCats.add(ci);
    changed();
    focusField(`cat-${ci}-title`);
  });

  function moveCategory(ci, dir) {
    const to = ci + dir;
    if (to < 0 || to >= state.categories.length) return;
    const [cat] = state.categories.splice(ci, 1);
    state.categories.splice(to, 0, cat);
    const wasOpen = openCats.has(ci), otherOpen = openCats.has(to);
    openCats.delete(ci); openCats.delete(to);
    if (wasOpen) openCats.add(to);
    if (otherOpen) openCats.add(ci);
    changed();
  }

  function moveClue(cat, qi, dir) {
    const to = qi + dir;
    if (to < 0 || to >= cat.clues.length) return;
    const [clue] = cat.clues.splice(qi, 1);
    cat.clues.splice(to, 0, clue);
    changed();
  }

  // After deleting index `removed`, shift open-card indexes above it down by one.
  function shiftSet(set, removed) {
    const next = new Set();
    set.forEach(i => { if (i < removed) next.add(i); else if (i > removed) next.add(i - 1); });
    return next;
  }

  function changed() { dirty = true; setStatus('Unsaved changes', 'dirty'); render(); }

  function markDirty(el) {
    if (el) el.classList.remove('invalid');
    dirty = true;
    setStatus('Unsaved changes', 'dirty');
    updateSaveButton();
  }

  function setStatus(text, cls) {
    saveStatus.textContent = text;
    saveStatus.className = 'save-status' + (cls ? ` ${cls}` : '');
  }

  function updateSaveButton() {
    btnSave.disabled = saving || !dirty;
    btnSave.textContent = saving ? 'Saving…' : 'Save';
  }

  // ---------- Validation (mirrors the server's checks) ----------
  function validate() {
    categoriesEl.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
    const problems = [];
    state.categories.forEach((cat, ci) => {
      const name = cat.title.trim() ? `"${cat.title.trim()}"` : `Category ${ci + 1}`;
      if (!cat.title.trim()) problems.push({ field: `cat-${ci}-title`, ci, msg: `${name} needs a title.` });
      cat.clues.forEach((clue, qi) => {
        const base = `cat-${ci}-clue-${qi}`;
        const v = Number(clue.value);
        if (!Number.isInteger(v) || v <= 0) problems.push({ field: `${base}-value`, ci, msg: `${name} clue ${qi + 1} needs a whole-number point value.` });
        if (!String(clue.clue || '').trim()) problems.push({ field: `${base}-clue`, ci, msg: `${name} clue ${qi + 1} is missing its clue.` });
        if (!String(clue.answer || '').trim()) problems.push({ field: `${base}-answer`, ci, msg: `${name} clue ${qi + 1} is missing its answer.` });
      });
    });
    return problems;
  }

  // ---------- Save ----------
  btnSave.addEventListener('click', save);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && screenEditor.classList.contains('active')) {
      e.preventDefault();
      if (dirty && !saving) save();
    }
  });

  async function save() {
    editorError.textContent = '';
    const problems = validate();
    if (problems.length) {
      problems.forEach(p => openCats.add(p.ci));
      render();
      problems.forEach(p => {
        const el = categoriesEl.querySelector(`[data-field="${p.field}"]`);
        if (el) el.classList.add('invalid');
      });
      editorError.textContent = problems.length === 1
        ? problems[0].msg
        : `${problems[0].msg} (and ${problems.length - 1} more highlighted in red)`;
      focusField(problems[0].field);
      return;
    }

    saving = true;
    updateSaveButton();
    setStatus('Saving…', '');
    try {
      const res = await api('PUT', '/api/questions', state);
      if (res.status === 401) {
        // Password changed or session lost — ask again, keep the edits in memory.
        password = '';
        storeDel(PW_KEY);
        editorError.textContent = 'The password was rejected. Lock and unlock again — your edits are still here until you leave this page.';
        setStatus('Not saved', 'dirty');
        return;
      }
      if (!res.ok) throw new Error(res.data.error || 'Saving failed.');
      dirty = false;
      sourceNote.textContent = '';
      setStatus(`Saved ${formatTime(res.data.updatedAt)} — reload the game to see it`, 'saved');
    } catch (err) {
      editorError.textContent = err.message;
      setStatus('Not saved', 'dirty');
    } finally {
      saving = false;
      updateSaveButton();
    }
  }

  // ---------- Reset ----------
  btnReset.addEventListener('click', async () => {
    if (!confirm('Delete your saved questions and go back to the built-in ones from questions.js? This can\'t be undone.')) return;
    editorError.textContent = '';
    try {
      const res = await api('DELETE', '/api/questions');
      if (!res.ok) throw new Error(res.data.error || 'Reset failed.');
      await openEditor();
    } catch (err) {
      editorError.textContent = err.message;
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const sameDay = d.toDateString() === new Date().toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return sameDay ? `at ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
  }

  // ---------- Init ----------
  const remembered = storeGet(PW_KEY);
  if (remembered) {
    tryLogin(remembered);
  } else {
    show(screenLogin);
    passwordInput.focus();
  }
})();
