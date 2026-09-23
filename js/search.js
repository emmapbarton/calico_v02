export function bindSearch(root, fixture) {
  const resultState = root.querySelector('[data-search-state="results"]');
  const emptyState = root.querySelector('[data-search-state="empty"]');
  const inputs = root.querySelectorAll('[data-search-state] input');
  const syncSearch = value => {
    const query = value.trim().toLowerCase();
    const hasMatches = !query || fixture.searchTerms.some(term => query.includes(term));
    resultState.classList.toggle('is-active', hasMatches);
    emptyState.classList.toggle('is-active', !hasMatches);
    inputs.forEach(input => { input.value = value; });
  };
  inputs.forEach(input => input.addEventListener('input', () => syncSearch(input.value)));
}
