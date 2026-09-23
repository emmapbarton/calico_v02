window.Calico = window.Calico || {};

window.Calico.bindAgenda = function bindAgenda(root, navigation) {
  root.querySelectorAll('.week-grid .block.task-blue, .week-grid .block.task-orange, .day-entry.task-blue, .day-entry.task-orange').forEach(block => {
    const adjust = document.createElement('button');
    adjust.className = 'adjust-block-hours';
    adjust.type = 'button';
    adjust.textContent = 'Adjust hours';
    adjust.addEventListener('click', event => {
      event.stopPropagation();
      navigation.openPanel('day-allocation');
    });
    block.appendChild(adjust);
  });

  const openTaskDetail = target => {
    target.tabIndex = 0;
    target.setAttribute('role', 'button');
    target.setAttribute('aria-label', 'Open task details');
    target.addEventListener('click', () => navigation.openPanel('task-detail'));
    target.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigation.openPanel('task-detail');
      }
    });
  };
  root.querySelectorAll('.week-grid .block.task-blue, .week-grid .block.task-orange, .day-entry.task-blue, .day-entry.task-orange').forEach(openTaskDetail);
  root.querySelectorAll('[data-page="agenda"] .agenda-row').forEach(row => {
    if (!row.textContent.includes('Event')) openTaskDetail(row);
  });

  const agendaTask = root.querySelector('[data-page="agenda"] .agenda-row');
  const agendaOutcome = root.querySelector('[data-page="agenda"] .outcome-panel');
  if (!agendaTask || !agendaOutcome) return;

  const disclosure = document.createElement('button');
  disclosure.className = 'agenda-disclosure';
  disclosure.type = 'button';
  disclosure.setAttribute('aria-label', 'Expand task update');
  disclosure.setAttribute('aria-expanded', 'false');
  disclosure.innerHTML = '<i data-lucide="chevron-down" aria-hidden="true"></i>';
  disclosure.addEventListener('click', event => {
    event.stopPropagation();
    const open = agendaOutcome.classList.toggle('is-open');
    disclosure.setAttribute('aria-expanded', String(open));
  });
  agendaTask.querySelector('strong').appendChild(disclosure);
}
