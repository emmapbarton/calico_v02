window.Calico = window.Calico || {};

window.Calico.createNavigation = function createNavigation(root, fixture) {
  const all = selector => root.querySelectorAll(selector);
  const show = (buttons, panels, buttonData, panelData, value) => {
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset[buttonData] === value)));
    panels.forEach(panel => panel.classList.toggle('is-active', panel.dataset[panelData] === value));
  };

  const packageButtons = all('[data-package]');
  const packages = all('[data-panel]');
  const overlayPanels = new Set(['new-item', 'reserve', 'day-hours', 'day-allocation', 'conflict', 'task-detail', 'search-feedback']);
  const period = root.querySelector('.package[data-panel="planner"] .period');
  let activeOverlay = null;

  const updatePeriod = page => {
    const rangePages = new Set(['week', 'agenda', 'review']);
    if (page === 'day') {
      period.hidden = false;
      period.textContent = fixture.dates.today;
    } else if (rangePages.has(page)) {
      period.hidden = false;
      period.innerHTML = `<b>‹</b>${fixture.dates.range}<b>›</b>`;
    } else {
      period.hidden = true;
    }
  };

  const openPanel = name => {
    const panel = root.querySelector(`[data-panel="${name}"]`);
    if (!panel) return;
    if (overlayPanels.has(name)) {
      panel.classList.add('is-active');
      activeOverlay = name;
      return;
    }
    activeOverlay = null;
    show(packageButtons, packages, 'package', 'panel', name);
  };

  const closePanel = () => {
    if (activeOverlay) {
      root.querySelector(`[data-panel="${activeOverlay}"]`)?.classList.remove('is-active');
      activeOverlay = null;
      return;
    }
    show(packageButtons, packages, 'package', 'panel', 'planner');
  };

  packageButtons.forEach(button => button.addEventListener('click', () => {
    openPanel(button.dataset.package);
    if (button.dataset.confirmTarget) root.querySelector(`[data-confirm-tab="${button.dataset.confirmTarget}"]`)?.click();
  }));

  const pageButtons = all('[data-page-button]');
  const pages = all('[data-page]');
  pageButtons.forEach(button => button.addEventListener('click', () => {
    show(pageButtons, pages, 'pageButton', 'page', button.dataset.pageButton);
    updatePeriod(button.dataset.pageButton);
  }));
  updatePeriod('week');

  const itemButtons = all('[data-item-type]');
  const itemForms = all('[data-item]');
  const itemTitle = root.querySelector('#new-item-title');
  const itemSave = root.querySelector('#new-item-save');
  itemButtons.forEach(button => button.addEventListener('click', () => {
    const type = button.dataset.itemType;
    show(itemButtons, itemForms, 'itemType', 'item', type);
    itemTitle.textContent = type === 'event' ? 'New event' : 'New task';
    itemSave.textContent = type === 'event' ? 'Add event' : 'Add task';
  }));

  const confirmTabs = all('[data-confirm-tab]');
  const confirmStates = all('[data-confirm-state]');
  const confirmAction = root.querySelector('[data-confirm-action]');
  confirmTabs.forEach(button => button.addEventListener('click', () => {
    const state = button.dataset.confirmTab;
    show(confirmTabs, confirmStates, 'confirmTab', 'confirmState', state);
    confirmAction.textContent = state === 'reset' ? 'Reset Calico' : state === 'project' ? 'Delete project' : 'Delete task';
  }));

  const accountButtons = all('[data-account-tab]');
  const accountStates = all('[data-account]');
  accountButtons.forEach(button => button.addEventListener('click', () => show(accountButtons, accountStates, 'accountTab', 'account', button.dataset.accountTab)));

  const welcomeButtons = all('[data-welcome]');
  const welcomeStates = all('[data-welcome-page]');
  welcomeButtons.forEach(button => button.addEventListener('click', () => welcomeStates.forEach(state => state.classList.toggle('is-active', state.dataset.welcomePage === button.dataset.welcome))));

  const setupNames = ['hours', 'energy', 'distribution', 'account'];
  const setupSteps = all('[data-setup]');
  const setupBack = root.querySelector('[data-setup-back]');
  const setupNext = root.querySelector('[data-setup-next]');
  let setupIndex = 0;
  const showSetup = index => {
    setupIndex = Math.max(0, Math.min(setupNames.length - 1, index));
    setupSteps.forEach(step => step.classList.toggle('is-active', step.dataset.setup === setupNames[setupIndex]));
    setupBack.style.visibility = setupIndex ? 'visible' : 'hidden';
    setupNext.textContent = setupIndex === setupNames.length - 1 ? 'Finish setup' : 'Continue';
    all('.setup-progress b').forEach((bar, i) => bar.classList.toggle('is-done', i <= setupIndex));
  };
  setupNext.addEventListener('click', () => showSetup(setupIndex === setupNames.length - 1 ? 0 : setupIndex + 1));
  setupBack.addEventListener('click', () => showSetup(setupIndex - 1));
  all('[data-energy]').forEach(button => button.addEventListener('click', () => all('[data-energy]').forEach(other => other.setAttribute('aria-pressed', String(other === button)))));
  all('[data-distribution]').forEach(button => button.addEventListener('click', () => all('[data-distribution]').forEach(other => other.setAttribute('aria-pressed', String(other === button)))));
  showSetup(0);

  return { closePanel, openPanel };
}
