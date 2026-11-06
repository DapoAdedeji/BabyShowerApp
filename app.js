// ============================================================
// EVENT HUB — welcome screen → menu
// ============================================================
(function () {
  const screenWelcome = document.getElementById('screen-welcome');
  const screenMenu = document.getElementById('screen-menu');
  const btnEnter = document.getElementById('btn-enter');

  function showMenu() {
    screenWelcome.classList.remove('active');
    screenMenu.classList.add('active');
    location.hash = 'menu';
  }

  btnEnter.addEventListener('click', showMenu);

  // Returning from a feature page (e.g. "../index.html#menu") should land
  // straight on the menu, not make the host click through Welcome again.
  if (location.hash === '#menu') {
    showMenu();
  }
})();
