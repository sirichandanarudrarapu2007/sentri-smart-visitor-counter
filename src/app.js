(() => {
  const config = window.SENTRI_CONFIG || { apiBaseUrl: '', mode: 'local-demo' };
  const apiBase = (config.apiBaseUrl || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  const capacityKey = 'sentriCapacity';
  let state = { inside: 24, total: 186, peak: 42, capacity: Number(localStorage.getItem(capacityKey)) || 80, logs: [] };
  const seedEvents = [
    { id:'EVT-00841', time:'10:42:18 AM', type:'IN', source:'Front entrance' },
    { id:'EVT-00840', time:'10:39:52 AM', type:'OUT', source:'Front entrance' },
    { id:'EVT-00839', time:'10:35:07 AM', type:'IN', source:'Front entrance' },
    { id:'EVT-00838', time:'10:31:44 AM', type:'IN', source:'Front entrance' },
    { id:'EVT-00837', time:'10:28:13 AM', type:'OUT', source:'Front entrance' }
  ];
  let isBusy = false;

  async function request(path, options = {}) {
    const response = await fetch(`${apiBase}/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Request failed (${response.status})`);
    return body;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function eventRow(event) {
    const type = event.type;
    return `<tr><td class="id">${escapeHtml(event.id)}</td><td>${escapeHtml(event.time)}</td><td><span class="badge ${type === 'OUT' ? 'out' : ''}"><i></i>${type === 'IN' ? 'Entry' : 'Exit'}</span></td><td class="source">${escapeHtml(event.source)}</td><td><span class="positive">● &nbsp;Counted</span></td></tr>`;
  }
  function render() {
    $('inside').textContent = state.inside;
    $('liveCount').textContent = state.inside;
    $('total').textContent = state.total;
    $('peak').textContent = state.peak;
    $('meter').style.width = `${Math.min(100, state.inside / state.capacity * 100)}%`;
    document.querySelectorAll('.counter-big em').forEach(el => el.textContent = `of ${state.capacity} capacity`);
    document.querySelector('.metric-sub').innerHTML = state.inside <= state.capacity
      ? `<span class="positive">● Within capacity</span> · limit ${state.capacity}`
      : `<span style="color:#dc5d62;font-weight:700">● Over capacity</span> · limit ${state.capacity}`;
    $('logBody').innerHTML = state.logs.length ? state.logs.slice(0,6).map(eventRow).join('') : '<tr><td class="empty" colspan="5">No activity yet. Record an entry or exit to get started.</td></tr>';
    const active = document.querySelector('.nav button.active')?.dataset.page;
    if (active && active !== 'overview') navTo(active);
    const mode = config.mode === 'aws' ? 'AWS' : 'DEMO';
    $('liveTag').innerHTML = `<i class="dot"></i> ${mode}`;
    $('connectionLabel').textContent = config.mode === 'aws' ? 'AWS API · connected' : 'Local demo · connected';
    $('syncLabel').textContent = 'Synced just now';
    document.querySelector('.footer span:last-child').textContent = config.mode === 'aws' ? 'Data stored in DynamoDB through API Gateway' : 'Data stored by the local demo server';
    $('todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  }
  function notify(message) {
    const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
    clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  async function refresh() {
    try {
      const data = await request('/state');
      state = { ...state, ...data, logs: data.logs || [] };
      render();
    } catch (error) {
      $('connectionLabel').textContent = 'API unavailable';
      $('syncLabel').textContent = 'Offline';
      notify(`Could not reach Sentri API: ${error.message}`);
    }
  }
  async function record(direction) {
    if (isBusy) return;
    isBusy = true;
    document.querySelectorAll('.control').forEach(button => button.disabled = true);
    try {
      const data = await request('/events', { method:'POST', body:JSON.stringify({ type:direction, source:'Front entrance' }) });
      state = { ...state, ...data.state, logs:data.logs || [] }; render();
      notify(direction === 'IN' ? 'Entry counted. Occupancy updated.' : 'Exit counted. Occupancy updated.');
    } catch (error) { notify(error.message); }
    finally { isBusy = false; document.querySelectorAll('.control').forEach(button => button.disabled = false); }
  }
  async function resetDemo() {
    if (config.mode === 'aws') { notify('Reset is available only in the local demo.'); return; }
    try { state = await request('/demo/reset', { method:'POST', body:'{}' }); render(); notify('Demo counter reset.'); }
    catch (error) { notify(error.message); }
  }
  function downloadCSV() {
    const rows = [['Event ID','Time','Type','Source','Status'], ...state.logs.map(e => [e.id,e.time,e.type,e.source,'Counted'])];
    const csv = rows.map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    link.download = 'sentri-visitor-activity.csv'; link.click(); URL.revokeObjectURL(link.href); notify('Activity exported as CSV.');
  }
  function navTo(page) {
    const main = document.querySelector('.main'), view = $('pageView');
    document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    if (page === 'overview') { main.classList.remove('alt'); view.hidden = true; document.querySelector('.crumb b').textContent='Overview'; return; }
    main.classList.add('alt'); view.hidden = false; view.className='page-view';
    document.querySelector('.crumb b').textContent = ({history:'Visitor history',devices:'Devices',reports:'Reports',settings:'Settings'})[page] || 'Overview';
    const pages = {
      history:`<h2>Visitor history</h2><p class="lead">Entry and exit events from your visitor counter.</p><table class="table"><thead><tr><th>EVENT ID</th><th>TIME</th><th>TYPE</th><th>SOURCE</th><th>STATUS</th></tr></thead><tbody>${state.logs.length ? state.logs.map(eventRow).join('') : '<tr><td colspan="5" class="empty">No activity recorded yet.</td></tr>'}</tbody></table><p><button class="action-btn" onclick="downloadCSV()">↓ &nbsp; Export visitor history</button></p>`,
      devices:`<h2>Devices</h2><p class="lead">Monitor sensors connected to this workspace.</p><div class="device-row"><div class="device-name">Front entrance · Sensor A1<small>Last sync: just now · Demo event source</small></div><span class="badge"><i></i>Online</span></div><div class="device-row"><div class="device-name">Cloud API<small>${config.mode === 'aws' ? 'API Gateway · Lambda · DynamoDB' : 'Local Node.js API · JSON file storage'}</small></div><span class="badge"><i></i>Healthy</span></div>`,
      reports:`<h2>Reports</h2><p class="lead">Visitor activity summary for today.</p><div class="view-grid"><div class="view-tile"><small>Total visitors today</small><strong>${state.total}</strong><p>Recorded entries</p></div><div class="view-tile"><small>Currently inside</small><strong>${state.inside}</strong><p>Live occupancy</p></div><div class="view-tile"><small>Peak occupancy</small><strong>${state.peak}</strong><p>Highest count today</p></div></div><p><button class="action-btn" onclick="downloadCSV()">↓ &nbsp; Download activity report (CSV)</button></p>`,
      settings:`<h2>Workspace settings</h2><p class="lead">Manage counting preferences for this workspace.</p><div class="setting-row"><div><b>Workspace admin</b><small>Sentri workspace administrator</small></div><span class="badge">Administrator</span></div><div class="setting-row"><div><b>Occupancy capacity</b><small>Maximum people allowed inside at one time.</small></div><input class="setting-input" type="number" min="1" value="${state.capacity}" id="capacityInput" ${config.mode === 'aws' ? 'disabled' : ''}></div><div class="setting-row"><div><b>Data storage</b><small>${config.mode === 'aws' ? 'AWS DynamoDB via API Gateway and Lambda.' : 'Local JSON database managed by the demo server.'}</small></div><span>${config.mode === 'aws' ? 'AWS cloud' : 'Local demo'}</span></div><p><button class="action-btn" onclick="saveSettings()">Save settings</button></p>`
    };
    view.innerHTML = pages[page] || pages.history;
  }
  async function saveSettings() {
    const value = Number($('capacityInput')?.value);
    if (!Number.isFinite(value) || value < 1) { notify('Enter a capacity greater than zero.'); return; }
    try { const data = await request('/settings',{method:'PUT',body:JSON.stringify({capacity:value})}); state={...state,...data}; localStorage.setItem(capacityKey,String(value)); render(); notify('Workspace settings saved.'); }
    catch(error) { notify(error.message); }
  }
  document.querySelectorAll('.nav button').forEach(button => button.addEventListener('click', () => navTo(button.dataset.page)));
  document.querySelectorAll('.segmented button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.segmented button').forEach(item => item.classList.toggle('active', item === button));
    $('period').value = button.dataset.period; notify(button.dataset.period === 'Today' ? 'Showing today’s visitor traffic.' : `Showing ${button.dataset.period.toLowerCase()} visitor traffic (demo summary).`);
  }));
  $('period').addEventListener('change', event => {
    document.querySelectorAll('.segmented button').forEach(button => button.classList.toggle('active',button.dataset.period===event.target.value));
    notify(`Date range set to ${event.target.value.toLowerCase()}.`);
  });
  window.navTo=navTo; window.record=record; window.resetDemo=resetDemo; window.downloadCSV=downloadCSV; window.saveSettings=saveSettings; window.notify=notify;
  refresh(); setInterval(refresh, 15000);
})();
