(() => {
  const workspace = document.getElementById('ieumWorkspace');
  const rail = workspace.querySelector('.ieum-rail');
  const sourceNav = document.getElementById('campusNav');
  const compact = matchMedia('(max-width: 1180px)');
  const phone = matchMedia('(max-width: 760px)');

  const dock = document.createElement('nav');
  dock.className = 'ieum-web-dock';
  dock.setAttribute('aria-label', '빠른 메뉴');
  dock.innerHTML = `
    <button type="button" data-campus-tab="home"><svg aria-hidden="true"><use href="#i-grid"/></svg>홈</button>
    <button type="button" data-campus-tab="notices"><svg aria-hidden="true"><use href="#i-file"/></svg>교내 소식</button>
    <button type="button" data-campus-tab="events"><svg aria-hidden="true"><use href="#i-calendar"/></svg>행사</button>
    <button type="button" data-campus-tab="messages"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 4 10 15m11-11-7 17-4-6-7-4Z"/></svg>문자<span class="ieum-message-badge hidden" aria-hidden="true"></span></button>
    <button type="button" aria-controls="ieumWebMenu" aria-expanded="false"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>전체 메뉴</button>`;
  workspace.append(dock);

  const menu = document.createElement('dialog');
  menu.id = 'ieumWebMenu';
  menu.setAttribute('aria-labelledby', 'ieumWebMenuTitle');
  menu.innerHTML = `<header class="ieum-web-menu-head"><h2 id="ieumWebMenuTitle">이음 메뉴</h2>
    <button type="button" class="icon-btn" aria-label="메뉴 닫기" data-web-menu-close>×</button></header>`;
  document.body.append(menu);

  const toggle = dock.querySelector('[aria-controls=ieumWebMenu]');
  const messages = dock.querySelector('[data-campus-tab=messages]');
  const messageSource = document.getElementById('ieumMessagesEntry');
  const messageBadge = messages.querySelector('.ieum-message-badge');
  const sourceBadge = messageSource.querySelector('[data-message-badge]');

  function syncDock() {
    const active = sourceNav.querySelector('[aria-current=page]')?.dataset.campusTab;
    for (const button of dock.querySelectorAll('[data-campus-tab]')) {
      if (active === button.dataset.campusTab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    const badge = sourceBadge.textContent;
    if (messageBadge.textContent !== badge) messageBadge.textContent = badge;
    messageBadge.classList.toggle('hidden', sourceBadge.classList.contains('hidden'));
    const messageLabel = messageSource.getAttribute('aria-label');
    if (messageLabel) messages.setAttribute('aria-label', messageLabel);
    else messages.removeAttribute('aria-label');
  }

  function positionNavigation() {
    if (compact.matches) menu.append(rail);
    else {
      if (menu.open) menu.close();
      workspace.prepend(rail);
    }
  }

  toggle.addEventListener('click', () => {
    menu.showModal();
    toggle.setAttribute('aria-expanded', 'true');
  });
  menu.addEventListener('close', () => toggle.setAttribute('aria-expanded', 'false'));
  menu.addEventListener('click', event => {
    if (event.target === menu || event.target.closest('[data-web-menu-close], #campusNav button')) menu.close();
  });

  const changes = new MutationObserver(syncDock);
  changes.observe(sourceNav, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['aria-current', 'aria-label', 'class'] });
  compact.addEventListener('change', positionNavigation);
  positionNavigation();
  syncDock();

  const navigation = '#campusNav button, [data-campus-tab], [data-campus-event], [data-campus-notice], [data-event-proposal], [data-school-section], [data-announcement-room], [data-linked-announcement]';
  document.addEventListener('click', event => {
    if (phone.matches && event.target.closest(navigation)) window.scrollTo({ top: 0, behavior: 'instant' });
  });
})();
