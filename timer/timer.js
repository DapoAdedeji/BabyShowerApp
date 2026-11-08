// ============================================================
// TIMER — configurable countdown for the hosts' other games.
// Pick a preset, nudge ±10s or type an exact time, then Start.
// Last 10s turn red; at zero: big TIME'S UP!, flashing card and a
// chime (mutable). The chosen time and sound setting are remembered
// on this device. Admin-only (the Worker keeps guests out of /timer/).
// ============================================================
(function () {
  const PRESETS = [30, 60, 120, 180, 300, 600]; // seconds
  const MIN_S = 5, MAX_S = 99 * 60 + 59, NUDGE_S = 10, WARN_S = 10;
  const PREFS_KEY = 'showerTimerPrefs_v1';

  const $ = id => document.getElementById(id);
  const card = $('timer-card');
  const setup = $('timer-setup');
  const countdown = $('countdown');
  const digits = $('digits');
  const barFill = $('bar-fill');
  const timesUp = $('times-up');
  const btnStart = $('btn-start');
  const inputMin = $('input-min');
  const inputSec = $('input-sec');

  const prefs = loadPrefs();
  const t = { duration: prefs.seconds, remainingMs: prefs.seconds * 1000, endAt: 0, running: false, done: false, interval: null };
  let audioCtx = null;

  // ---------- Prefs ----------
  function loadPrefs() {
    const p = { seconds: 60, sound: true };
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (Number.isFinite(saved.seconds)) p.seconds = clamp(saved.seconds);
      if (typeof saved.sound === 'boolean') p.sound = saved.sound;
    } catch (e) { /* storage blocked: defaults */ }
    return p;
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }
  function clamp(s) { return Math.min(MAX_S, Math.max(MIN_S, Math.round(s))); }
  function fmt(totalSeconds) {
    const m = Math.floor(totalSeconds / 60), s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function presetLabel(s) { return s < 60 ? `${s}s` : `${s / 60} min`; }

  // ---------- Setting the time (only while not running) ----------
  function setDuration(seconds) {
    stop();
    t.duration = clamp(seconds);
    t.remainingMs = t.duration * 1000;
    t.done = false;
    card.classList.remove('flash');
    prefs.seconds = t.duration;
    savePrefs();
    render();
  }

  PRESETS.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.dataset.seconds = s;
    b.textContent = presetLabel(s);
    b.addEventListener('click', () => setDuration(s));
    $('presets').appendChild(b);
  });
  $('btn-minus').addEventListener('click', () => setDuration(t.duration - NUDGE_S));
  $('btn-plus').addEventListener('click', () => setDuration(t.duration + NUDGE_S));

  function fromInputs() {
    const m = Math.max(0, Math.min(99, parseInt(inputMin.value, 10) || 0));
    const s = Math.max(0, Math.min(59, parseInt(inputSec.value, 10) || 0));
    setDuration(m * 60 + s);
  }
  [inputMin, inputSec].forEach(inp => {
    inp.addEventListener('change', fromInputs);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { inp.blur(); fromInputs(); } });
  });

  // ---------- Running ----------
  function start() {
    if (t.done || t.remainingMs <= 0) setDuration(t.duration);
    unlockAudio();
    t.endAt = performance.now() + t.remainingMs;
    t.running = true;
    t.interval = setInterval(tick, 100);
    render();
  }
  function pause() {
    if (!t.running) return;
    t.remainingMs = Math.max(0, t.endAt - performance.now());
    stop();
    render();
  }
  function stop() {
    t.running = false;
    clearInterval(t.interval);
  }
  function tick() {
    t.remainingMs = Math.max(0, t.endAt - performance.now());
    if (t.remainingMs <= 0) return finish();
    render();
  }
  function finish() {
    stop();
    t.remainingMs = 0;
    t.done = true;
    render();
    card.classList.remove('flash');
    void card.offsetWidth; // restart the animation
    card.classList.add('flash');
    if (prefs.sound) chime();
  }

  btnStart.addEventListener('click', () => (t.running ? pause() : start()));
  $('btn-reset').addEventListener('click', () => setDuration(t.duration));

  // ---------- Render ----------
  function render() {
    const secs = Math.ceil(t.remainingMs / 1000);
    digits.textContent = fmt(secs);
    barFill.style.width = `${Math.max(0, Math.min(1, t.remainingMs / (t.duration * 1000))) * 100}%`;

    const started = t.remainingMs < t.duration * 1000;
    countdown.classList.toggle('warning', !t.done && started && secs <= WARN_S);
    countdown.classList.toggle('paused', !t.running && started && !t.done);
    countdown.classList.toggle('done', t.done);
    timesUp.textContent = t.done ? '⏰ TIME\'S UP!' : '';

    btnStart.textContent = t.running ? '⏸ Pause' : t.done ? '▶ Again' : started ? '▶ Resume' : '▶ Start';
    // Lock the setup while a countdown is in progress (Reset unlocks it).
    setup.classList.toggle('locked', t.running || (started && !t.done));

    document.querySelectorAll('.preset').forEach(b => b.classList.toggle('selected', Number(b.dataset.seconds) === t.duration));
    if (document.activeElement !== inputMin && document.activeElement !== inputSec) {
      inputMin.value = Math.floor(t.duration / 60);
      inputSec.value = String(t.duration % 60).padStart(2, '0');
    }
    $('btn-sound').textContent = prefs.sound ? '🔔' : '🔕';
    $('btn-sound').setAttribute('aria-label', prefs.sound ? 'Mute time\'s-up sound' : 'Unmute time\'s-up sound');
  }

  // ---------- Sound ----------
  $('btn-sound').addEventListener('click', () => { prefs.sound = !prefs.sound; savePrefs(); render(); });
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }
  function chime() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [660, 880, 1100, 880, 1100].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const at = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + 0.4);
    });
  }

  // ---------- Full screen ----------
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }
  $('btn-fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement);
  });

  // ---------- Keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); t.running ? pause() : start(); }
    else if (e.key === 'r' || e.key === 'R') setDuration(t.duration);
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });

  render();
})();
