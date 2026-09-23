function boot() {
  const { bindAgenda, bindOverlays, bindSearch, createNavigation, fixture } = window.Calico;
  const root = document.getElementById('calico-design-package');
  const navigation = createNavigation(root, fixture);
  bindOverlays(root, navigation);
  bindAgenda(root, navigation);
  bindSearch(root, fixture);
  window.lucide?.createIcons();
}

document.addEventListener('DOMContentLoaded', boot, { once: true });
