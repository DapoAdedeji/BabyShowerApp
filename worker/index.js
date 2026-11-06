// ============================================================
// BABY SHOWER APP — Cloudflare Worker
// ============================================================
// Serves the static site (env.ASSETS) and a tiny API for the
// Jeopardy question editor. Questions live in Cloudflare KV
// (env.QUESTIONS) under one key; the admin password is the
// ADMIN_PASSWORD secret (set in the dashboard, never in code).
//
//   GET    /api/questions     -> saved questions, or 404 if none saved yet
//                                (the game then falls back to questions.js)
//   POST   /api/admin/login   -> checks the password (for the admin login screen)
//   PUT    /api/questions     -> save questions          (password required)
//   DELETE /api/questions     -> back to questions.js defaults (password required)
//
// Password is sent as:  Authorization: Bearer <password>
// ============================================================

const KV_KEY = 'jeopardy-questions';

// Generous limits — they only exist to stop junk being stored.
const LIMITS = {
  categories: 12,
  cluesPerCategory: 10,
  text: 600,     // clue / answer length
  title: 120,    // category title, game title / subtitle length
  value: 100000
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: 'Something went wrong on the server.' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (!env.QUESTIONS) {
    return json({ error: 'Question storage (KV) is not connected to this Worker.' }, 503);
  }

  if (pathname === '/api/questions' && method === 'GET') {
    const saved = await env.QUESTIONS.get(KV_KEY);
    if (!saved) return json({ error: 'No saved questions yet.' }, 404);
    return new Response(saved, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    const authError = await checkAuth(request, env);
    return authError || json({ ok: true });
  }

  if (pathname === '/api/questions' && method === 'PUT') {
    const authError = await checkAuth(request, env);
    if (authError) return authError;

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'That wasn\'t valid JSON.' }, 400);
    }
    const result = validate(body);
    if (result.error) return json({ error: result.error }, 400);

    const toSave = { ...result.data, updatedAt: new Date().toISOString() };
    await env.QUESTIONS.put(KV_KEY, JSON.stringify(toSave));
    return json({ ok: true, updatedAt: toSave.updatedAt });
  }

  if (pathname === '/api/questions' && method === 'DELETE') {
    const authError = await checkAuth(request, env);
    if (authError) return authError;
    await env.QUESTIONS.delete(KV_KEY);
    return json({ ok: true });
  }

  return json({ error: 'Not found.' }, 404);
}

// Returns an error Response, or null if the password is right.
async function checkAuth(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: 'No admin password has been set up for this site yet.' }, 503);
  }
  const header = request.headers.get('Authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (given && (await safeEqual(given, env.ADMIN_PASSWORD))) return null;

  // Slow down password guessing a little.
  await new Promise(resolve => setTimeout(resolve, 800));
  return json({ error: 'Wrong password.' }, 401);
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

// Checks shape + limits and returns a cleaned copy (only known fields kept).
function validate(body) {
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
