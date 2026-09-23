export function bindOverlays(root, navigation) {
  root.querySelectorAll('.close, [data-close-overlay]').forEach(button => button.addEventListener('click', navigation.closePanel));

  const conflictFooter = root.querySelector('[data-panel="conflict"] .sheet-foot');
  if (!conflictFooter) return;

  const [notNow, save] = conflictFooter.querySelectorAll('button');
  notNow.addEventListener('click', navigation.closePanel);
  save.textContent = 'Save';
}
