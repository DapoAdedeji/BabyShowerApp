// ============================================================
// GUEST HOME — welcome screen → menu (mirrors the admin hub's app.js)
// ============================================================
(function () {
  const screenWelcome = document.getElementById('screen-welcome');
  const screenMenu = document.getElementById('screen-menu');

  function showMenu() {
    screenWelcome.classList.remove('active');
    screenMenu.classList.add('active');
    location.hash = 'menu';
  }

  document.getElementById('btn-enter').addEventListener('click', showMenu);

  // Coming back from a guest page ("/guest/#menu") skips the welcome screen.
  if (location.hash === '#menu') showMenu();
})();
