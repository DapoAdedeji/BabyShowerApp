// ============================================================
// SIGN OUT — any element with data-signout signs the visitor out
// (clears the server sign-in cookie) and returns to the welcome page.
// Shared by admin and guest pages, so it's a public file.
// ============================================================
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-signout]');
  if (!el) return;
  e.preventDefault();
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (err) { /* still go to the welcome page */ }
  location.href = '/welcome/';
});
