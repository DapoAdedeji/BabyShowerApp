// ============================================================
// BABY SHOWER APP — Cloudflare Worker
// ============================================================
// 1. SIGN-IN GATE for the whole site. Everyone starts at /welcome/ and
//    signs in as a Guest or an Admin (host). The choice is remembered in
//    a signed, HttpOnly cookie, and every request is checked here on the
//    server — hiding links in the page wouldn't stop a guest typing a URL.
//      - Not signed in -> /welcome/
//      - Guest         -> only /guest/ (home + view-only leaderboard)
//                         and /guess-that-baby/
//      - Admin         -> everything (the full app)
//
// 2. A small JSON API, with data in Cloudflare KV (env.QUESTIONS):
//   POST   /api/auth/login      { role, password } -> sets the sign-in cookie
//   POST   /api/auth/logout     -> clears it
//   GET    /api/auth/me         -> { role } or { role: null }
//   GET    /api/leaderboard     -> teams + scores          (guest or admin)
//   PUT    /api/leaderboard     -> admin app syncs scores   (admin)
//   GET    /api/questions       -> saved Jeopardy questions (admin)
//   PUT    /api/questions       -> save questions           (admin)
//   DELETE /api/questions       -> back to questions.js     (admin)
//   POST   /api/admin/login     -> checks admin access (question editor)
//   /api/gtb/...                 -> Guess That Baby (see the section below)
//
// Admin API calls are allowed with the admin cookie OR the header
// "Authorization: Bearer <ADMIN_PASSWORD>".
//
// Secrets (Cloudflare dashboard -> Settings -> Variables and Secrets,
// and `npx wrangler preview base-config secret put` for previews):
//   ADMIN_PASSWORD, GUEST_PASSWORD
// ============================================================

const QUESTIONS_KEY = 'jeopardy-questions';
const LEADERBOARD_KEY = 'leaderboard';
const COOKIE = 'bs_session';
const SESSION_DAYS = 30;

// Generous limits — they only exist to stop junk being stored.
const LIMITS = {
  categories: 12,
  cluesPerCategory: 10,
  text: 600,     // clue / answer length
  title: 120,    // category title, game title / subtitle length
  value: 100000,
  teams: 12,
  teamName: 40
};

// Who can open which pages. Paths are matched as "the folder or anything in it".
const PUBLIC_PATHS = ['/welcome'];
const PUBLIC_FILES = ['/style.css', '/signout.js', '/favicon.ico', '/robots.txt'];
const GUEST_PATHS = ['/guest', '/guess-that-baby'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      return await handlePage(request, env, url);
    } catch (err) {
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  }
};

// ---------- Pages (static assets behind the sign-in gate) ----------
async function handlePage(request, env, url) {
  const path = url.pathname;

  if (matches(path, PUBLIC_PATHS) || PUBLIC_FILES.includes(path)) {
    return env.ASSETS.fetch(request);
  }

  const session = await readSession(request, env);

  if (!session) {
    if (!isPageRequest(path)) return new Response('Please sign in.', { status: 401 });
    const next = path === '/' ? '' : `?next=${encodeURIComponent(path + url.search)}`;
    return redirect(`/welcome/${next}`);
  }

  if (session.role === 'guest' && !matches(path, GUEST_PATHS)) {
    if (!isPageRequest(path)) return new Response('Not available for guests.', { status: 403 });
    return redirect('/guest/');
  }

  // Ask browsers to re-check with us before reusing a cached page, so a
  // signed-out or switched-role visitor can't see pages from the cache.
  const res = await env.ASSETS.fetch(request);
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'private, no-cache');
  return out;
}

function matches(path, prefixes) {
  return prefixes.some(p => path === p || path.startsWith(p + '/'));
}

// Pages get redirected; files (scripts, styles, images) just get refused.
function isPageRequest(path) {
  const last = path.split('/').pop();
  return !last.includes('.') || last.endsWith('.html');
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

// ---------- API ----------
async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  // --- Sign in / out ---
  if (pathname === '/api/auth/login' && method === 'POST') return login(request, env);
  if (pathname === '/api/auth/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }
  if (pathname === '/api/auth/me' && method === 'GET') {
    const session = await readSession(request, env);
    return json({ role: session ? session.role : null });
  }

  if (!env.QUESTIONS) {
    return json({ error: 'Storage (KV) is not connected to this Worker.' }, 503);
  }

  // --- Leaderboard ---
  if (pathname === '/api/leaderboard' && method === 'GET') {
    const session = await readSession(request, env);
    if (!session && !(await hasAdminBearer(request, env))) return json({ error: 'Please sign in.' }, 401);
    const saved = await env.QUESTIONS.get(LEADERBOARD_KEY);
    return new Response(saved || JSON.stringify({ teams: [], updatedAt: null }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
  if (pathname === '/api/leaderboard' && method === 'PUT') {
    const authError = await requireAdmin(request, env);
    if (authError) return authError;
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'That wasn\'t valid JSON.' }, 400); }
    const result = validateLeaderboard(body);
    if (result.error) return json({ error: result.error }, 400);
    const toSave = { teams: result.teams, updatedAt: new Date().toISOString() };
    await env.QUESTIONS.put(LEADERBOARD_KEY, JSON.stringify(toSave));
    return json({ ok: true, updatedAt: toSave.updatedAt });
  }

  // --- Jeopardy questions (admin only) ---
  if (pathname === '/api/admin/login' && method === 'POST') {
    const authError = await requireAdmin(request, env);
    return authError || json({ ok: true });
  }

  if (pathname === '/api/questions') {
    const authError = await requireAdmin(request, env);
    if (authError) return authError;

    if (method === 'GET') {
      const saved = await env.QUESTIONS.get(QUESTIONS_KEY);
      if (!saved) return json({ error: 'No saved questions yet.' }, 404);
      return new Response(saved, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }
    if (method === 'PUT') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'That wasn\'t valid JSON.' }, 400); }
      const result = validateQuestions(body);
      if (result.error) return json({ error: result.error }, 400);
      const toSave = { ...result.data, updatedAt: new Date().toISOString() };
      await env.QUESTIONS.put(QUESTIONS_KEY, JSON.stringify(toSave));
      return json({ ok: true, updatedAt: toSave.updatedAt });
    }
    if (method === 'DELETE') {
      await env.QUESTIONS.delete(QUESTIONS_KEY);
      return json({ ok: true });
    }
  }

  if (pathname.startsWith('/api/gtb/')) return handleGtb(request, env, url);

  return json({ error: 'Not found.' }, 404);
}

// ============================================================
// GUESS THAT BABY
// ============================================================
// Each team (from the Leaderboard) claims ONE phone, then matches every
// baby photo to a name. Each name can be used once per team.
//
// KV records (one per team where several phones write at once, because
// KV can't safely merge simultaneous edits to the same record):
//   gtb:config                     { photos:[{n,img}], names:[...], key:{n:name} }
//                                  (missing -> built-in demo set; `key` is
//                                  the answers and never goes to guests
//                                  until the host reveals)
//   gtb:state                      { round, status: open|closed|revealed }
//   gtb:claim:<round>:<team>       { token }  which phone owns the team
//   gtb:sheet:<round>:<team>       { answers:{ "1": "Name", ... } }
// "Restart" starts a new round id, so old claims and sheets are ignored.
//
// Guest (or admin) endpoints — the phone identifies itself with the
// headers X-GTB-Team + X-GTB-Token it got when claiming:
//   GET  /api/gtb/state            everything the phone needs to draw the game
//   POST /api/gtb/claim  {team}    claim a team -> { token }
//   PUT  /api/gtb/answers {answers} save this team's sheet (only while open)
// Admin endpoints:
//   GET  /api/gtb/admin            full picture: claims, sheets, answer key
//   POST /api/gtb/close | /open | /reveal | /reset
//   POST /api/gtb/release {team}   free a team so another phone can claim it
//   PUT  /api/gtb/config           replace photos / names / answer key

const GTB_DEMO_NAMES = [
  'Aunty Bisi', 'Uncle Tunde', 'Grandma Joy', 'Grandpa Femi', 'Cousin Tolu',
  'Aunty Kemi', 'Uncle Segun', 'Sister Ada', 'Brother Chidi', 'Aunty Funmi',
  'Uncle Kunle', 'Cousin Ife', 'Aunty Ronke', 'Uncle Bayo', 'Cousin Zara',
  'Aunty Nkem', 'Uncle Dele', 'Cousin Remi', 'Aunty Yemi', 'Uncle Gbenga',
  'Cousin Ola', 'Aunty Sade', 'Uncle Jide', 'Cousin Ami', 'Aunty Lola',
  'Uncle Wale', 'Cousin Kiki', 'Aunty Dami', 'Uncle Niyi', 'Cousin Bola'
];

function gtbDemoConfig() {
  const photos = [];
  const key = {};
  for (let n = 1; n <= 30; n++) {
    photos.push({ n, img: `/guess-that-baby/demo/${n}.svg` });
    // A fixed scramble so the answer isn't just "name n for photo n".
    key[n] = GTB_DEMO_NAMES[(n * 7) % 30];
  }
  return { photos, names: [...GTB_DEMO_NAMES], key, demo: true };
}

async function gtbConfig(env) {
  const saved = await env.QUESTIONS.get('gtb:config', 'json');
  return saved || gtbDemoConfig();
}
async function gtbState(env) {
  const saved = await env.QUESTIONS.get('gtb:state', 'json');
  return saved || { round: 'r1', status: 'open' };
}
async function gtbTeams(env) {
  const lb = await env.QUESTIONS.get(LEADERBOARD_KEY, 'json');
  return lb && Array.isArray(lb.teams) ? lb.teams : [];
}
const gtbClaimKey = (round, team) => `gtb:claim:${round}:${encodeURIComponent(team)}`;
const gtbSheetKey = (round, team) => `gtb:sheet:${round}:${encodeURIComponent(team)}`;

// KV allows about one write per second to the same record; turn its
// rate-limit error into a friendly 429 the phone retries.
async function kvPut(env, key, value) {
  try {
    await env.QUESTIONS.put(key, JSON.stringify(value));
    return null;
  } catch (e) {
    return json({ error: 'Saving too fast — retrying…' }, 429);
  }
}

function gtbScore(answers, key) {
  let correct = 0;
  for (const n of Object.keys(key)) if (answers && answers[n] === key[n]) correct++;
  return correct;
}

// Does this phone own a team? Returns the team name or null.
async function gtbMyTeam(request, env, state) {
  const team = decodeURIComponent(request.headers.get('X-GTB-Team') || '');
  const token = request.headers.get('X-GTB-Token') || '';
  if (!team || !token) return null;
  const claim = await env.QUESTIONS.get(gtbClaimKey(state.round, team), 'json');
  return claim && claim.token === token ? team : null;
}

async function handleGtb(request, env, url) {
  const route = url.pathname.slice('/api/gtb/'.length);
  const method = request.method;
  const session = await readSession(request, env);
  const isAdmin = (session && session.role === 'admin') || (await hasAdminBearer(request, env));
  if (!session && !isAdmin) return json({ error: 'Please sign in.' }, 401);

  // ---------- Phone (guest) endpoints ----------
  if (route === 'state' && method === 'GET') {
    const [config, state, teams] = await Promise.all([gtbConfig(env), gtbState(env), gtbTeams(env)]);
    const claims = await Promise.all(teams.map(t => env.QUESTIONS.get(gtbClaimKey(state.round, t.name), 'json')));
    const myTeam = await gtbMyTeam(request, env, state);
    const sheet = myTeam ? (await env.QUESTIONS.get(gtbSheetKey(state.round, myTeam), 'json')) : null;
    const answers = (sheet && sheet.answers) || {};
    const revealed = state.status === 'revealed';
    return json({
      status: state.status,
      round: state.round,
      teams: teams.map((t, i) => ({ name: t.name, color: t.color, claimed: !!claims[i] })),
      photos: config.photos,
      names: [...config.names].sort((a, b) => a.localeCompare(b)),
      myTeam,
      answers,
      demo: !!config.demo,
      // Answers only leave the server once the host reveals them.
      key: revealed ? config.key : null,
      score: revealed && myTeam ? gtbScore(answers, config.key) : null
    });
  }

  if (route === 'claim' && method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (e) { /* handled below */ }
    const team = typeof body.team === 'string' ? body.team : '';
    const [state, teams] = await Promise.all([gtbState(env), gtbTeams(env)]);
    if (!teams.length) return json({ error: 'The Leaderboard isn\'t set up yet — ask the host to add the teams.' }, 409);
    if (!teams.some(t => t.name === team)) return json({ error: 'That team isn\'t on the Leaderboard.' }, 400);
    if (state.status !== 'open') return json({ error: 'This round is closed.' }, 409);

    const claimKey = gtbClaimKey(state.round, team);
    if (await env.QUESTIONS.get(claimKey)) return json({ error: 'Another phone has already joined as that team.' }, 409);
    const token = crypto.randomUUID();
    const err = await kvPut(env, claimKey, { token, at: new Date().toISOString() });
    if (err) return err;
    // Read back: if two phones picked the same team at the same instant,
    // only the one whose token stuck gets it.
    const check = await env.QUESTIONS.get(claimKey, 'json');
    if (!check || check.token !== token) return json({ error: 'Another phone has already joined as that team.' }, 409);
    return json({ ok: true, team, token });
  }

  if (route === 'answers' && method === 'PUT') {
    const state = await gtbState(env);
    const myTeam = await gtbMyTeam(request, env, state);
    if (!myTeam) return json({ error: 'This phone isn\'t linked to a team any more.' }, 403);
    if (state.status !== 'open') return json({ error: 'The round is closed — answers are locked.' }, 409);
    let body = {};
    try { body = await request.json(); } catch (e) { return json({ error: 'That wasn\'t valid JSON.' }, 400); }
    const config = await gtbConfig(env);
    const validNumbers = new Set(config.photos.map(p => String(p.n)));
    const validNames = new Set(config.names);
    const answers = {};
    const used = new Set();
    for (const [n, name] of Object.entries((body && body.answers) || {})) {
      if (!name) continue;
      if (!validNumbers.has(String(n))) return json({ error: `There's no photo #${n}.` }, 400);
      if (!validNames.has(name)) return json({ error: `"${name}" isn't on the list.` }, 400);
      if (used.has(name)) return json({ error: `"${name}" is used twice — each name can only be used once.` }, 400);
      used.add(name);
      answers[String(n)] = name;
    }
    const err = await kvPut(env, gtbSheetKey(state.round, myTeam), { answers, updatedAt: new Date().toISOString() });
    return err || json({ ok: true });
  }

  // ---------- Host (admin) endpoints ----------
  if (!isAdmin) return json({ error: 'Only the host can do that.' }, 403);

  if (route === 'admin' && method === 'GET') {
    const [config, state, teams] = await Promise.all([gtbConfig(env), gtbState(env), gtbTeams(env)]);
    const rows = await Promise.all(teams.map(async t => {
      const [claim, sheet] = await Promise.all([
        env.QUESTIONS.get(gtbClaimKey(state.round, t.name), 'json'),
        env.QUESTIONS.get(gtbSheetKey(state.round, t.name), 'json')
      ]);
      const answers = (sheet && sheet.answers) || {};
      return {
        name: t.name,
        color: t.color,
        claimed: !!claim,
        answered: Object.keys(answers).length,
        answers,
        correct: gtbScore(answers, config.key)
      };
    }));
    return json({ status: state.status, round: state.round, config, teams: rows });
  }

  const STATUS_FOR = { close: 'closed', open: 'open', reveal: 'revealed' };
  if (STATUS_FOR[route] && method === 'POST') {
    const state = await gtbState(env);
    if (route === 'reveal' && state.status === 'open') return json({ error: 'Close the round before revealing.' }, 409);
    const err = await kvPut(env, 'gtb:state', { ...state, status: STATUS_FOR[route], updatedAt: new Date().toISOString() });
    return err || json({ ok: true, status: STATUS_FOR[route] });
  }

  if (route === 'reset' && method === 'POST') {
    const round = `r${Date.now().toString(36)}`;
    const err = await kvPut(env, 'gtb:state', { round, status: 'open', updatedAt: new Date().toISOString() });
    return err || json({ ok: true, round });
  }

  if (route === 'release' && method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (e) { /* handled below */ }
    if (typeof body.team !== 'string' || !body.team) return json({ error: 'Which team?' }, 400);
    const state = await gtbState(env);
    // Answers are kept: whichever phone claims the team next carries on.
    await env.QUESTIONS.delete(gtbClaimKey(state.round, body.team));
    return json({ ok: true });
  }

  if (route === 'config' && method === 'PUT') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'That wasn\'t valid JSON.' }, 400); }
    const result = validateGtbConfig(body);
    if (result.error) return json({ error: result.error }, 400);
    const err = await kvPut(env, 'gtb:config', result.config);
    return err || json({ ok: true });
  }

  return json({ error: 'Not found.' }, 404);
}

function validateGtbConfig(body) {
  if (!body || !Array.isArray(body.photos) || !Array.isArray(body.names)) return { error: 'Need photos and names.' };
  if (body.photos.length < 1 || body.photos.length > 60) return { error: 'Between 1 and 60 photos.' };
  const names = body.names.map(n => cleanText(n, 60)).filter(Boolean);
  if (new Set(names).size !== names.length) return { error: 'Names must be unique.' };
  const photos = [];
  const key = {};
  for (const p of body.photos) {
    const n = Number(p && p.n);
    const img = typeof (p && p.img) === 'string' ? p.img.slice(0, 500) : '';
    if (!Number.isInteger(n) || n < 1 || n > 60) return { error: 'Photo numbers must be 1–60.' };
    if (!img.startsWith('/') && !img.startsWith('https://')) return { error: `Photo #${n} needs an image.` };
    const answer = body.key && body.key[n];
    if (answer && !names.includes(answer)) return { error: `Photo #${n}'s answer isn't in the names list.` };
    photos.push({ n, img });
    if (answer) key[n] = answer;
  }
  return { config: { photos, names, key } };
}

// ---------- Sign-in ----------
async function login(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'That wasn\'t valid JSON.' }, 400); }
  const role = body && body.role;
  const password = body && typeof body.password === 'string' ? body.password : '';

  if (role !== 'guest' && role !== 'admin') return json({ error: 'Choose Guest or Host.' }, 400);
  const expected = role === 'admin' ? env.ADMIN_PASSWORD : env.GUEST_PASSWORD;
  if (!expected) {
    return json({ error: `The ${role === 'admin' ? 'host' : 'guest'} password hasn't been set up yet.` }, 503);
  }
  if (!password || !(await safeEqual(password, expected))) {
    await slowDown();
    return json({ error: 'That password isn\'t right — try again.' }, 401);
  }

  const token = await signSession(env, { r: role, e: Date.now() + SESSION_DAYS * 86400000 });
  return json({ ok: true, role }, 200, {
    'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`
  });
}

// Admin cookie, or the admin password as a Bearer token.
async function requireAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: 'No admin password has been set up for this site yet.' }, 503);
  }
  const session = await readSession(request, env);
  if (session && session.role === 'admin') return null;
  if (await hasAdminBearer(request, env)) return null;
  if (request.headers.get('Authorization')) await slowDown();
  return json({ error: 'Wrong password.' }, 401);
}

async function hasAdminBearer(request, env) {
  const header = request.headers.get('Authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  return !!(given && env.ADMIN_PASSWORD && (await safeEqual(given, env.ADMIN_PASSWORD)));
}

// Slow down password guessing a little.
function slowDown() {
  return new Promise(resolve => setTimeout(resolve, 800));
}

// ---------- Signed session cookie ----------
// Token = base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature).
// The signing key is derived from both passwords, so changing either
// password signs everybody out.
async function sessionKey(env) {
  const material = `baby-shower-session|${env.ADMIN_PASSWORD || ''}|${env.GUEST_PASSWORD || ''}`;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return crypto.subtle.importKey('raw', hash, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signSession(env, payload) {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(env), new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

async function readSession(request, env) {
  if (!env.ADMIN_PASSWORD && !env.GUEST_PASSWORD) return null;
  const token = getCookie(request, COOKIE);
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  try {
    const ok = await crypto.subtle.verify('HMAC', await sessionKey(env), b64urlDecode(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!payload || (payload.r !== 'guest' && payload.r !== 'admin') || !(payload.e > Date.now())) return null;
    return { role: payload.r };
  } catch (e) {
    return null;
  }
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function b64urlEncode(bytes) {
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// Constant-time comparison (hash first so lengths always match).
// Leading/trailing whitespace is ignored on both sides: a password pasted
// into the dashboard with a stray space or newline, or a phone keyboard
// adding a space, shouldn't lock anyone out.
async function safeEqual(a, b) {
  a = String(a).trim();
  b = String(b).trim();
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ---------- Validation ----------
function validateLeaderboard(body) {
  if (!body || !Array.isArray(body.teams)) return { error: 'Missing teams.' };
  if (body.teams.length > LIMITS.teams) return { error: `Too many teams (max ${LIMITS.teams}).` };
  const teams = [];
  for (const t of body.teams) {
    const name = cleanText(t && t.name, LIMITS.teamName);
    const score = Number(t && t.score);
    const color = typeof (t && t.color) === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(t.color) ? t.color : '#8fd9f7';
    if (!name) return { error: 'Every team needs a name.' };
    if (!Number.isFinite(score) || Math.abs(score) > 10000000) return { error: `Bad score for ${name}.` };
    teams.push({ name, score: Math.round(score), color });
  }
  return { teams };
}

// Checks shape + limits and returns a cleaned copy (only known fields kept).
function validateQuestions(body) {
  if (!body || typeof body !== 'object') return { error: 'Missing question data.' };
  const { title, subtitle, categories } = body;

  if (!Array.isArray(categories) || categories.length === 0) {
    return { error: 'You need at least one category.' };
  }
  if (categories.length > LIMITS.categories) {
    return { error: `Too many categories (max ${LIMITS.categories}).` };
  }

  const clean = {
    title: cleanText(title, LIMITS.title),
    subtitle: cleanText(subtitle, LIMITS.title),
    categories: []
  };

  for (let c = 0; c < categories.length; c++) {
    const cat = categories[c] || {};
    const label = `Category ${c + 1}`;
    const catTitle = cleanText(cat.title, LIMITS.title);
    if (!catTitle) return { error: `${label} needs a title.` };
    if (!Array.isArray(cat.clues) || cat.clues.length === 0) {
      return { error: `"${catTitle}" needs at least one clue.` };
    }
    if (cat.clues.length > LIMITS.cluesPerCategory) {
      return { error: `"${catTitle}" has too many clues (max ${LIMITS.cluesPerCategory}).` };
    }

    const clues = [];
    for (let i = 0; i < cat.clues.length; i++) {
      const clue = cat.clues[i] || {};
      const where = `"${catTitle}" clue ${i + 1}`;
      const value = Number(clue.value);
      if (!Number.isInteger(value) || value <= 0 || value > LIMITS.value) {
        return { error: `${where} needs a whole-number point value above 0.` };
      }
      const clueText = cleanText(clue.clue, LIMITS.text);
      const answer = cleanText(clue.answer, LIMITS.text);
      if (!clueText) return { error: `${where} is missing its clue.` };
      if (!answer) return { error: `${where} is missing its answer.` };
      clues.push({ value, clue: clueText, answer });
    }
    clean.categories.push({ title: catTitle, clues });
  }
  return { data: clean };
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders }
  });
}
