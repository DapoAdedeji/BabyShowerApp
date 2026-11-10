// ============================================================
// BABY PHOTOS — read-only Guess That Baby gallery for guests.
// Shows the numbered photos only (GET /api/gtb/photos): no names, no
// answers, no team, nothing saved, nothing tracked on the host screen.
// ============================================================
(function () {
  const $ = id => document.getElementById(id);
  let photos = [];
  let current = 0; // index into photos while the viewer is open
  let lastJson = '';

  async function load() {
    try {
      const res = await fetch('/api/gtb/photos', { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 401) { location.href = '/welcome/?next=/guest/photos/'; return; }
      if (!res.ok) throw new Error();
      const data = await res.json();
      const json = JSON.stringify(data.photos);
      if (json === lastJson) return; // unchanged — don't redraw
      lastJson = json;
      photos = data.photos;
      render();
    } catch (e) {
      if (!photos.length) $('gallery-status').textContent = 'Couldn\'t load the photos — check your connection and try again.';
    }
  }

  function render() {
    const grid = $('gallery');
    grid.innerHTML = '';
    $('gallery-status').textContent = photos.length ? '' : 'The photos aren\'t up yet — check back soon! 📸';
    photos.forEach((p, i) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'photo-tile';
      tile.setAttribute('aria-label', `Baby number ${p.n} — tap to enlarge`);
      const img = document.createElement('img');
      img.src = p.img;
      img.alt = `Baby photo number ${p.n}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      const num = document.createElement('span');
      num.className = 'photo-num';
      num.textContent = p.n;
      tile.append(img, num);
      tile.addEventListener('click', () => open(i));
      grid.appendChild(tile);
    });
  }

  // ---------- Viewer ----------
  function open(i) {
    current = i;
    $('viewer').hidden = false;
    document.body.style.overflow = 'hidden';
    show();
    $('viewer-close').focus();
  }
  function close() {
    $('viewer').hidden = true;
    document.body.style.overflow = '';
    const tile = $('gallery').children[current];
    if (tile) tile.focus();
  }
  function show() {
    const p = photos[current];
    $('viewer-img').src = p.img;
    $('viewer-img').alt = `Baby photo number ${p.n}`;
    $('viewer-label').textContent = `Baby #${p.n}`;
    $('viewer-count').textContent = `${current + 1} of ${photos.length}`;
    $('viewer-prev').disabled = current === 0;
    $('viewer-next').disabled = current === photos.length - 1;
  }
  function step(dir) {
    const next = current + dir;
    if (next < 0 || next >= photos.length) return;
    current = next;
    show();
  }

  $('viewer-close').addEventListener('click', close);
  $('viewer-prev').addEventListener('click', () => step(-1));
  $('viewer-next').addEventListener('click', () => step(1));
  $('viewer-stage').addEventListener('click', e => { if (e.target.id === 'viewer-stage') close(); });
  document.addEventListener('keydown', e => {
    if ($('viewer').hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  });

  // Swipe left/right in the viewer.
  let touchX = null;
  $('viewer-stage').addEventListener('touchstart', e => {
    touchX = e.touches.length === 1 ? e.touches[0].clientX : null; // ignore pinch-zoom
  }, { passive: true });
  $('viewer-stage').addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  });

  load();
  // Pick up a new photo set if the hosts upload one (e.g. while the page is open).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
