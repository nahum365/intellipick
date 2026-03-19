const TABS = ['All Regions', 'East', 'West', 'South', 'Midwest'];

export function createFilters(onFilter) {
  const container = document.createElement('div');
  container.className = 'filters';

  let activeTab = 'All Regions';

  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.className = 'filters__tab' + (tab === activeTab ? ' filters__tab--active' : '');
    btn.textContent = tab;
    btn.addEventListener('click', () => {
      activeTab = tab;
      container.querySelectorAll('.filters__tab').forEach(b => b.classList.remove('filters__tab--active'));
      btn.classList.add('filters__tab--active');
      onFilter(tab === 'All Regions' ? null : tab);
    });
    container.appendChild(btn);
  }

  return container;
}
