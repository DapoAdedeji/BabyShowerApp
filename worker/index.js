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

  return json({ error: 'Not found.' }, 404);
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
async function safeEqual(a, b) {
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
