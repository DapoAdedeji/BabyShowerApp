// ============================================================
// TEAM CAPTAIN & GUEST HOMES — welcome screen → menu (mirrors the admin
// hub's app.js). A public file so both roles' home pages can load it.
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

  // Coming back from another page ("/#menu" -> this home) skips the welcome screen.
  if (location.hash === '#menu') showMenu();
})();
