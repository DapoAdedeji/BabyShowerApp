// ============================================================
// WELCOME / SIGN-IN — choose Guest (read-only), Team Captain or Admin,
// then enter that role's password.
// The Worker (../worker/index.js) checks the password and sets a
// sign-in cookie; every page is then gated on the server.
// ============================================================
(function () {
  const HOME = { viewer: '/guest/', captain: '/captain/', admin: '/' };
  const LABEL = { viewer: 'Guest', captain: 'Team Captain', admin: 'Admin' };
  // Pages each role may be sent back to after signing in (admins: anywhere).
  const ALLOWED = {
    viewer: /^\/(guest|scores)(\/|$)/,
    captain: /^\/(captain|guess-that-baby|scores)(\/|$)/
  };

  const form = document.getElementById('signin-form');
  const passwordStep = document.getElementById('password-step');
  const passwordLabel = document.getElementById('password-label');
  const passwordInput = document.getElementById('password');
  const errorEl = document.getElementById('signin-error');
  const btnSignin = document.getElementById('btn-signin');
  const signedInNote = document.getElementById('signed-in-note');

  function selectedRole() {
    const checked = form.querySelector('input[name="role"]:checked');
    return checked ? checked.value : null;
  }

  form.querySelectorAll('input[name="role"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const role = selectedRole();
      passwordLabel.textContent = `${LABEL[role]} password`;
      errorEl.textContent = '';
      passwordInput.value = '';
      passwordStep.hidden = false;
      passwordInput.focus();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = selectedRole();
    if (!role) return;
    if (!passwordInput.value) {
      errorEl.textContent = 'Please enter the password.';
      passwordInput.focus();
      return;
    }

    errorEl.textContent = '';
    btnSignin.disabled = true;
    btnSignin.textContent = 'Checking…';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ role, password: passwordInput.value })
      });
      let data = {};
      try { data = await res.json(); } catch (err) { /* not JSON */ }
      if (!res.ok) throw new Error(data.error || 'Couldn\'t sign in. Please try again.');
      location.href = destination(role);
    } catch (err) {
      errorEl.textContent = err.message === 'Failed to fetch'
        ? 'Couldn\'t reach the server. Check your connection and try again.'
        : err.message;
      passwordInput.select();
    } finally {
      btnSignin.disabled = false;
      btnSignin.textContent = 'Sign in →';
    }
  });

  // Go back to the page they originally asked for, if their role can see it.
  function destination(role) {
    const next = new URLSearchParams(location.search).get('next');
    const safe = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/welcome');
    if (!safe) return HOME[role];
    if (ALLOWED[role] && !ALLOWED[role].test(next)) return HOME[role];
    if (role === 'captain' && next.startsWith('/guess-that-baby/host')) return HOME.captain;
    return next;
  }

  // Already signed in? Offer a shortcut (they can still switch roles below).
  fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (!data || !data.role) return;
      signedInNote.innerHTML = '';
      if (!LABEL[data.role]) return;
      signedInNote.append(`You're signed in as ${LABEL[data.role]}. `);
      const link = document.createElement('a');
      link.href = HOME[data.role] || '/';
      link.textContent = 'Continue →';
      signedInNote.appendChild(link);
      signedInNote.hidden = false;
    })
    .catch(() => { /* offline or no API — just show the form */ });
})();
