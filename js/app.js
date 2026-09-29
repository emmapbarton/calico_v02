window.Calico = window.Calico || {};

function boot() {
  const { bindOverlays, bindUiWiring, createNavigation, fixture } = window.Calico;
  const root = document.getElementById('calico-design-package');
  window.Calico.store = window.Calico.state.createStore();
  window.Calico.plan = () => window.Calico.planner.allocateSchedule(window.Calico.store.getState());

  const navigation = createNavigation(root, fixture);
  bindOverlays(root, navigation);
  bindUiWiring(root, navigation);
  window.lucide?.createIcons();
}

document.addEventListener('DOMContentLoaded', boot, { once: true });
