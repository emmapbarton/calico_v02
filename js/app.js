import { bindAgenda } from './agenda.js';
import { fixture } from './fixtures.js';
import { createNavigation } from './navigation.js';
import { bindOverlays } from './overlays.js';
import { bindSearch } from './search.js';

function boot() {
  const root = document.getElementById('calico-design-package');
  const navigation = createNavigation(root, fixture);
  bindOverlays(root, navigation);
  bindAgenda(root, navigation);
  bindSearch(root, fixture);
  window.lucide?.createIcons();
}

document.addEventListener('DOMContentLoaded', boot, { once: true });
