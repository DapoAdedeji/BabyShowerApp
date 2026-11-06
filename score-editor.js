// ============================================================
// SCORE EDITOR — shared "fix the scores" popup
// ============================================================
// For settling disputes: lets the host nudge or overwrite any
// team's score by hand. Used by the Leaderboard and every game.
// Self-contained (injects its own styles), and reads/writes the
// shared ShowerSession — so include it AFTER session.js:
//   <script src="../session.js"></script>
//   <script src="../score-editor.js"></script>
//
// API:
//   ScoreEditor.open({ step: 100, onSave: (teams) => { ... } })
//     step   -> how much the −/+ buttons change a score (default 100)
//     onSave -> called with the updated teams after the host saves
// Nothing is written until the host hits "Save". Cancel, Escape or
// clicking outside the popup throws the edits away.
// ============================================================

window.ScoreEditor = (function () {
  let overlay = null;
  let onSaveCb = null;
  let step = 100;

  const CSS = `
  .se-overlay {
    position: fixed; inset: 0; z-index: 1000;
    display: none; align-items: center; justify-content: center;
    background: rgba(74, 59, 82, 0.45);
    padding: 16px;
  }
  .se-overlay.active { display: flex; }
  .se-card {
    background: var(--white, #fffdfb);
    border-radius: var(--radius-lg, 28px);
    box-shadow: 0 20px 50px var(--shadow, rgba(122, 90, 120, 0.18));
    padding: 28px 28px 24px;
    width: 100%; max-width: 480px;
    max-height: calc(100vh - 32px); overflow-y: auto;
    color: var(--ink, #4a3b52);
    font-family: var(--font-body, system-ui, sans-serif);
    text-align: center;
  }
  .se-title {
    font-family: var(--font-display, system-ui, sans-serif);
    font-size: 1.7rem; margin: 0 0 4px;
  }
  .se-sub { margin: 0 0 18px; color: var(--ink-soft, #7a6b82); font-weight: 600; }
  .se-rows { display: flex; flex-direction: column; gap: 10px; margin-bottom: 22px; }
  .se-row {
    display: flex; align-items: center; gap: 10px;
    border: 2px solid var(--lavender, #e6dcfb);
    border-radius: var(--radius-sm, 12px);
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.8);
  }
  .se-swatch { width: 16px; height: 16px; border-radius: 50%; flex: none; }
  .se-name {
    flex: 1; min-width: 0; text-align: left; font-weight: 700;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .se-was { font-size: 0.8rem; color: var(--ink-soft, #7a6b82); font-weight: 600; margin-left: 4px; }
  .se-btn {
    flex: none; width: 38px; height: 38px; border-radius: 50%;
    border: 2px solid var(--lavender, #e6dcfb);
    background: var(--white, #fffdfb);
    font-family: var(--font-display, system-ui, sans-serif);
    font-size: 1.3rem; font-weight: 800; line-height: 1;
    color: var(--ink, #4a3b52); cursor: pointer;
  }
  .se-btn:hover { background: var(--lavender, #e6dcfb); }
  .se-input {
    flex: none; width: 84px; padding: 6px 8px;
    border: 2px solid var(--lavender, #e6dcfb);
    border-radius: var(--radius-sm, 12px);
    font-family: var(--font-display, system-ui, sans-serif);
    font-size: 1.2rem; font-weight: 800; text-align: center;
    color: var(--pink-deep, #ff9ecf);
  }
  .se-input:focus { outline: none; border-color: var(--pink-deep, #ff9ecf); }
  .se-row.changed { border-color: var(--butter-deep, #ffe066); background: var(--butter, #fff6cf); }
  .se-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  @media (max-width: 480px) {
    .se-card { padding: 22px 16px 18px; }
    .se-input { width: 64px; }
    .se-btn { width: 34px; height: 34px; }
  }
  `;

  function ensureDom() {
    if (overlay) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.className = 'se-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'se-title');
    overlay.innerHTML = `
      <div class="se-card">
        <h2 class="se-title" id="se-title">✏️ Edit Scores</h2>
        <p class="se-sub">Settle any disputes — changes save to the leaderboard.</p>
        <div class="se-rows"></div>
        <div class="se-actions">
          <button type="button" class="btn-ghost se-cancel">Cancel</button>
          <button type="button" class="btn-primary se-save">Save Scores</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.se-cancel').addEventListener('click', close);
    overlay.querySelector('.se-save').addEventListener('click', save);
    document.addEventListener('keydown', (e) => {
      if (!overlay.classList.contains('active')) return;
      if (e.key === 'Escape') close();
      // Only from a score box — Enter on a focused button should just press that button.
      if (e.key === 'Enter' && e.target.classList.contains('se-input')) save();
    });
  }

  function open(opts) {
    opts = opts || {};
    if (!window.ShowerSession || !ShowerSession.hasTeams()) return;
    ensureDom();
    onSaveCb = opts.onSave || null;
    step = opts.step || 100;
    renderRows();
    overlay.classList.add('active');
  }

  function renderRows() {
    const rowsEl = overlay.querySelector('.se-rows');
    rowsEl.innerHTML = '';
    ShowerSession.getTeams().forEach((team, i) => {
      const row = document.createElement('div');
      row.className = 'se-row';
      row.innerHTML = `
        <span class="se-swatch" style="background:${team.color}"></span>
        <span class="se-name"></span>
        <button type="button" class="se-btn" data-dir="-1" aria-label="Subtract ${step}">−</button>
        <input class="se-input" type="number" inputmode="numeric" step="${step}" data-idx="${i}" />
        <button type="button" class="se-btn" data-dir="1" aria-label="Add ${step}">+</button>
      `;
      const nameEl = row.querySelector('.se-name');
      nameEl.textContent = team.name;
      const was = document.createElement('span');
      was.className = 'se-was';
      nameEl.appendChild(was);

      const input = row.querySelector('.se-input');
      input.value = team.score;
      input.setAttribute('aria-label', `${team.name} score`);

      const markChanged = () => {
        const changed = Number(input.value) !== team.score;
        row.classList.toggle('changed', changed);
        was.textContent = changed ? ` (was ${team.score})` : '';
      };
      input.addEventListener('input', markChanged);
      row.querySelectorAll('.se-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const current = Number(input.value) || 0;
          input.value = current + step * Number(btn.dataset.dir);
          markChanged();
        });
      });
      rowsEl.appendChild(row);
    });
  }

  function save() {
    const inputs = overlay.querySelectorAll('.se-input');
    const current = ShowerSession.getTeams();
    // A blank/invalid box keeps that team's existing score.
    const scores = Array.from(inputs).map((inp, i) => {
      const n = Number(inp.value);
      return inp.value.trim() !== '' && Number.isFinite(n) ? n : current[i].score;
    });
    ShowerSession.setScores(scores);
    close();
    if (onSaveCb) onSaveCb(ShowerSession.getTeams());
  }

  function close() {
    if (overlay) overlay.classList.remove('active');
  }

  return { open, close };
})();
