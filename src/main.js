import './style.css';

const nodeTypes = {
  router: { icon: '◆', label: 'Router', className: 'router' },
  gateway: { icon: '↗', label: 'Gateway', className: 'gateway' },
  server: { icon: '▣', label: 'Server', className: 'server' },
  camera: { icon: '◉', label: 'Camera', className: 'camera' },
  device: { icon: '◇', label: 'Device', className: 'device' },
};

let nodes = [
  { id: 'gateway', name: '5G Internet Gateway', type: 'gateway', x: 51, y: 15, status: 'healthy', ip: '10.0.0.1', uptime: '99.99%', rx: 24.7, tx: 15.9 },
  { id: 'router', name: 'Core Router', type: 'router', x: 50, y: 43, status: 'healthy', ip: '192.168.88.1', uptime: '99.97%', rx: 41.6, tx: 3.1 },
  { id: 'office', name: 'Thessaloniki Office', type: 'server', x: 82, y: 46, status: 'warning', ip: '192.168.88.20', uptime: '99.60%', rx: 5.8, tx: 5.5 },
  { id: 'dsl', name: 'DSL Router', type: 'router', x: 30, y: 68, status: 'offline', ip: '192.168.88.254', uptime: '95.42%', rx: 0, tx: 0 },
  { id: 'basement', name: 'Basement OpenWRT', type: 'device', x: 62, y: 76, status: 'healthy', ip: '192.168.88.101', uptime: '99.92%', rx: 0.3, tx: 0.1 },
  { id: 'dvr', name: 'DVR NIKITI', type: 'camera', x: 14, y: 22, status: 'healthy', ip: '192.168.88.80', uptime: '99.89%', rx: 8.2, tx: 2.4 },
  { id: 'guest', name: 'AvenueGuests-2.4G', type: 'device', x: 51, y: 87, status: 'offline', ip: '192.168.88.170', uptime: '91.34%', rx: 0, tx: 0 },
];

let links = [];
let selectedId = 'router';
let dragging = null;
let settingsFeedback = '';
let actionsMenuOpen = false;
let editingSettings = false;
let settingsDraft = null;
let linking = null;
let selectedLinkId = '';
let contextMenu = null;
let pingFeedback = '';
let refreshInFlight = false;
let interfaceOptions = [];
let editingLink = false;
let workspaceName = 'NIKITI SITE';
let workspaceMenuOpen = false;
let editingWorkspaceName = false;
let workspaceFeedback = '';
const API_URL = '/api/nodes';

const app = document.querySelector('#app');

document.addEventListener('contextmenu', (event) => event.preventDefault());

function statusLabel(status) {
  return status === 'healthy' ? 'Online' : status === 'warning' ? 'Degraded' : 'Offline';
}

function render() {
  const selected = nodes.find((node) => node.id === selectedId) || nodes[0];
  if (!nodeTypes[selected.type]) selected.type = 'device';
  const formValues = settingsDraft?.id === selected.id ? settingsDraft : selected;
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#"><span class="brand-mark">N</span><span>network<span>atlas</span></span></a>
      ${renderSiteSwitcher()}
      <div class="top-actions"><span class="live"><i></i> LIVE</span><button class="icon-button" title="Notifications">♧<b>2</b></button><button class="avatar" title="Account">SA</button></div>
    </header>
    <main class="workspace">
      <aside class="sidebar">
        <div class="nav-section"><span class="section-label">WORKSPACE</span><button class="nav-item active">⌘ <span>Topology</span></button><button class="nav-item">◴ <span>Events</span><em>12</em></button><button class="nav-item">▥ <span>Reports</span></button></div>
        <div class="nav-section palette"><span class="section-label">ADD TO MAP</span>${Object.entries(nodeTypes).map(([key, item]) => `<button class="tool" draggable="true" data-type="${key}"><span class="tool-icon ${item.className}">${item.icon}</span>${item.label}<small>Drag</small></button>`).join('')}</div>
        <div class="sidebar-footer"><span>MONITORED HOSTS</span><strong>${nodes.length}</strong><div class="health-bar"><i></i><i></i><i></i><i class="down"></i></div><small>5 online · 1 degraded · 2 offline</small></div>
      </aside>
      <section class="content">
        <div class="canvas-toolbar"><div><h1>Site topology</h1><p>Live infrastructure overview <span>Updated just now</span></p></div><div class="toolbar-actions"><button class="outline-btn" id="fit-map">⊙</button><button class="outline-btn ${linking ? 'selected-tool' : ''}" id="connect-mode">⌁ <span>${linking ? 'Select target' : 'Connect'}</span></button><button class="primary-btn" id="add-device">＋ <span>Device</span></button></div></div>
        <div class="canvas-wrap" id="canvas-wrap">
          <div class="canvas" id="canvas">
            <svg class="links" id="links" aria-hidden="true"></svg>
            ${nodes.map((node) => renderNode(node)).join('')}
            <div class="canvas-hint"><kbd>⌘</kbd> + scroll to zoom <span>·</span> Drag components to arrange</div>
          </div>
        </div>
      </section>
      <aside class="inspector">
        <div class="inspector-heading"><span>DEVICE DETAILS</span><button class="close-inspector" title="Close inspector">×</button></div>
        <div class="device-hero"><div class="large-icon ${nodeTypes[selected.type].className}">${nodeTypes[selected.type].icon}</div><div><h2>${selected.name}</h2><p><span class="status-dot ${selected.status}"></span>${statusLabel(selected.status)}</p></div><div class="device-actions"><button class="more" id="device-actions" title="More device actions" aria-expanded="${actionsMenuOpen}">•••</button>${actionsMenuOpen ? '<button class="delete-device" id="delete-device">Delete device</button>' : ''}</div></div>
        <div class="snmp-identity"><span>SNMP SYSTEM NAME</span><strong>${selected.systemName || '--'}</strong>${selected.platformVersion ? `<small>${selected.platformVersion}</small>` : ''}</div>
        <form class="device-settings" id="device-form"><label><span>DEVICE NAME</span><input name="name" value="${formValues.name}" aria-label="Device name" /></label><label><span>DEVICE TYPE</span><select name="type" aria-label="Device type">${Object.entries(nodeTypes).map(([key, item]) => `<option value="${key}" ${formValues.type === key ? 'selected' : ''}>${item.label}</option>`).join('')}</select></label><label><span>ROUTER PLATFORM</span><select name="platform" aria-label="Router platform"><option value="other" ${formValues.platform === 'other' ? 'selected' : ''}>Other / standard SNMP</option><option value="mikrotik" ${formValues.platform === 'mikrotik' ? 'selected' : ''}>MikroTik RouterOS</option><option value="openwrt" ${formValues.platform === 'openwrt' ? 'selected' : ''}>OpenWRT</option></select></label><label><span>IP ADDRESS</span><input name="ip" value="${formValues.ip}" aria-label="IP address" spellcheck="false" /></label><label><span>SNMP COMMUNITY</span><input name="community" type="password" placeholder="Keep current value" aria-label="SNMP community" autocomplete="new-password" /></label><label><span>SNMP PORT</span><input name="port" type="number" min="1" max="65535" value="${formValues.port || 161}" aria-label="SNMP port" /></label><button class="save-settings" type="submit">Save settings</button><p class="settings-feedback ${settingsFeedback.startsWith('Could not') ? 'error' : ''}" aria-live="polite">${settingsFeedback}</p></form>
        <div class="property-grid"><div><span>UPTIME</span><strong>${selected.uptime || '--'}</strong></div><div><span>LATENCY</span><strong>${selected.status === 'offline' ? '--' : `${selected.latency || 12} ms`}</strong></div><div><span>PACKET LOSS</span><strong>${selected.status === 'offline' ? '--' : selected.status === 'warning' ? '2.8%' : '0.0%'}</strong></div></div>
        <div class="metric"><div><span>CPU UTILIZATION</span><strong>${selected.cpu ?? '--'}${selected.cpu === undefined ? '' : '%'}</strong></div><div class="meter"><i style="width:${selected.cpu ?? 0}%"></i></div></div>
        <div class="metric"><div><span>MEMORY</span><strong>${selected.memory ?? '--'}${selected.memory === undefined ? '' : '%'}</strong></div><div class="meter teal"><i style="width:${selected.memory ?? 0}%"></i></div></div>
        <div class="traffic-title"><span>TRAFFIC</span><button>24H ⌄</button></div><div class="chart"><svg viewBox="0 0 280 100" preserveAspectRatio="none"><path d="M0 83 L12 77 L25 80 L38 58 L52 68 L66 42 L79 54 L93 27 L106 46 L120 39 L134 64 L148 45 L161 57 L175 31 L188 43 L202 25 L216 49 L229 40 L242 62 L255 53 L268 72 L280 58 V100 H0Z"></path><polyline points="0,83 12,77 25,80 38,58 52,68 66,42 79,54 93,27 106,46 120,39 134,64 148,45 161,57 175,31 188,43 202,25 216,49 229,40 242,62 255,53 268,72 280,58"></polyline></svg><div class="chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>NOW</span></div></div>
        <button class="event-button">View device events <span>→</span></button>
      </aside>${linking?.step === 'source' ? renderLinkDialog() : ''}${renderLinkEditor()}${renderContextMenu()}${pingFeedback ? `<div class="ping-feedback">${pingFeedback}</div>` : ''}
    </main>`;
  bindEvents();
  drawLinks();
}

function renderLinkDialog() {
  return `<div class="link-dialog"><form id="link-form"><h2>Create link</h2><label>Source node<select name="sourceId" id="link-source">${nodes.map((node) => `<option value="${node.id}" ${node.id === linking.sourceId ? 'selected' : ''}>${node.name}</option>`).join('')}</select></label>${renderInterfaceSelect()}<label>Interface IP address<input name="interfaceIp" placeholder="Optional label" /></label><button class="primary-btn" type="submit">Select target</button><button class="cancel-link" type="button" id="cancel-link">Cancel</button></form></div>`;
}

function renderInterfaceSelect(selectedIndex) {
  if (!interfaceOptions.length) return '<label>SNMP interface index<input name="interfaceIndex" type="number" min="1" value="1" required /></label>';
  return `<label>SNMP interface<select name="interfaceIndex">${interfaceOptions.map((item) => `<option value="${item.index}" ${Number(selectedIndex) === item.index ? 'selected' : ''}>${item.name} (index ${item.index})</option>`).join('')}</select></label>`;
}

function renderLinkEditor() {
  const link = links.find((item) => item.id === selectedLinkId);
  if (!link) return '';
  return `<div class="link-dialog"><form id="edit-link-form"><h2>Edit link source</h2><label>Source node<select name="sourceId" id="link-source">${nodes.map((node) => `<option value="${node.id}" ${node.id === link.sourceId ? 'selected' : ''}>${node.name}</option>`).join('')}</select></label><label>Target node<select name="targetId">${nodes.map((node) => `<option value="${node.id}" ${node.id === link.targetId ? 'selected' : ''}>${node.name}</option>`).join('')}</select></label>${renderInterfaceSelect(link.interfaceIndex)}<label>Interface IP address<input name="interfaceIp" value="${link.interfaceIp || ''}" /></label><button class="primary-btn" type="submit">Save link</button><button class="cancel-link" type="button" id="cancel-link">Cancel</button></form></div>`;
}

async function loadInterfaces(sourceId) {
  interfaceOptions = await fetch(`/api/nodes/${sourceId}/interfaces`).then((response) => response.ok ? response.json() : []);
  render();
}

function renderContextMenu() {
  if (!contextMenu) return '';
  return `<div class="node-menu" style="left:${contextMenu.x}px;top:${contextMenu.y}px"><button id="open-node-settings">⚙ <span>Settings</span></button><button id="duplicate-node">▣ <span>Duplicate</span></button><button id="ping-node">⌁ <span>Ping ${contextMenu.name}</span></button><hr /><button class="danger" id="delete-node-menu">× <span>Delete device</span></button></div>`;
}

function renderSiteSwitcher() {
  if (editingWorkspaceName) {
    return `<form class="site-switcher editing" id="workspace-rename-form"><span class="pulse"></span><input id="workspace-name-input" value="${workspaceName.replace(/"/g, '&quot;')}" maxlength="60" autocomplete="off" /><button type="submit" class="workspace-save" title="Save name">✓</button><button type="button" class="workspace-cancel" id="cancel-workspace-rename" title="Cancel">×</button></form>`;
  }
  return `<div class="site-switcher"><button class="site-switcher-label" id="workspace-menu-toggle"><span class="pulse"></span> ${workspaceName} <span class="caret">⌄</span></button>${workspaceMenuOpen ? `<div class="workspace-menu"><button id="rename-workspace">✎ <span>Rename workspace</span></button><button id="export-workspace">⬇ <span>Export workspace</span></button><button id="import-workspace">⬆ <span>Import workspace</span></button></div>` : ''}<input type="file" id="import-workspace-input" accept="application/json" hidden />${workspaceFeedback ? `<div class="workspace-feedback">${workspaceFeedback}</div>` : ''}</div>`;
}

function renderNode(node) {
  const type = nodeTypes[node.type];
  const traffic = `↓ ${node.rx} Mbps  ↑ ${node.tx} Mbps`;
  const detail = node.status === 'offline' ? (node.pingReachable ? `Ping ${node.pingLatency === null ? 'OK' : `${node.pingLatency} ms`}` : 'SNMP unavailable') : traffic;
  const stateClass = node.status === 'offline' && node.pingReachable ? 'ping-ok' : node.status;
  return `<button class="map-node ${stateClass}" data-id="${node.id}" style="left:${node.x}%;top:${node.y}%"><span class="node-icon ${type.className}">${type.icon}</span><span class="node-copy"><strong>${node.name}</strong><small>${detail}</small></span><span class="node-state"></span></button>`;
}

function drawLinks() {
  const svg = document.querySelector('#links');
  svg.innerHTML = links.map((link) => {
    const from = nodes.find((node) => node.id === link.sourceId);
    const to = nodes.find((node) => node.id === link.targetId);
    if (!from || !to) return '';
    const offline = from.status === 'offline' || to.status === 'offline';
    return `<line class="${offline ? 'offline-link' : ''}" data-link-id="${link.id}" x1="${from.x}%" y1="${from.y}%" x2="${to.x}%" y2="${to.y}%" /><text class="link-label" data-link-id="${link.id}" x="${(from.x + to.x) / 2}%" y="${(from.y + to.y) / 2}%">RX ${formatRate(link.rx)} | TX ${formatRate(link.tx)}</text>`;
  }).join('');
}

function formatRate(bits) {
  if (bits >= 1000000) return `${(bits / 1000000).toFixed(1)} Mbps`;
  if (bits >= 1000) return `${(bits / 1000).toFixed(1)} Kbps`;
  return `${Math.round(bits || 0)} bps`;
}

function bindEvents() {
  bindWorkspaceEvents();
  const canvas = document.querySelector('#canvas');
  document.querySelector('#links').addEventListener('click', (event) => {
    if (event.target.dataset.linkId) { selectedLinkId = event.target.dataset.linkId; render(); }
  });
  canvas.addEventListener('pointerdown', (event) => {
    const nodeElement = event.target.closest('.map-node');
    if (!nodeElement) return;
    const node = nodes.find((item) => item.id === nodeElement.dataset.id);
    if (linking?.step === 'target') {
      if (node.id === linking.sourceId) return;
      const source = nodes.find((item) => item.id === linking.sourceId);
      Promise.all([source, node].map((endpoint) => fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: endpoint.id, name: endpoint.name, type: endpoint.type, ip: endpoint.ip, x: endpoint.x, y: endpoint.y }) }).then((response) => response.ok || response.status === 409)))
        .then(() => fetch('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...linking, targetId: node.id }) }))
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((link) => { links.push(link); linking = null; pingFeedback = 'Link created.'; render(); })
        .catch(() => { linking = null; pingFeedback = 'Could not create link. Check the monitoring service.'; render(); });
      return;
    }
    selectedId = node.id;
    dragging = { id: node.id, startX: event.clientX, startY: event.clientY, x: node.x, y: node.y };
    nodeElement.setPointerCapture(event.pointerId);
    render();
  });
  canvas.addEventListener('contextmenu', (event) => {
    const nodeElement = event.target.closest('.map-node');
    if (!nodeElement) {
      if (contextMenu) {
        contextMenu = null;
        render();
      }
      return;
    }
    event.preventDefault();
    const node = nodes.find((item) => item.id === nodeElement.dataset.id);
    contextMenu = { id: node.id, name: node.name, x: event.clientX, y: event.clientY };
    render();
  });
  const pingButton = document.querySelector('#ping-node');
  if (pingButton) pingButton.addEventListener('click', async () => {
    const node = contextMenu;
    contextMenu = null;
    pingFeedback = `Pinging ${node.name}...`;
    render();
    try {
      const result = await fetch(`/api/nodes/${node.id}/ping`, { method: 'POST' }).then((response) => response.ok ? response.json() : Promise.reject());
      nodes = nodes.map((item) => item.id === node.id ? { ...item, pingReachable: result.reachable, pingLatency: result.latency } : item);
      pingFeedback = result.reachable ? `${node.name} replied${result.latency !== null ? ` in ${result.latency} ms` : ''}.` : `${node.name} did not reply.`;
    } catch {
      pingFeedback = `Could not ping ${node.name}.`;
    }
    render();
    setTimeout(() => { pingFeedback = ''; render(); }, 4000);
  });
  const settingsButton = document.querySelector('#open-node-settings');
  if (settingsButton) settingsButton.addEventListener('click', () => {
    selectedId = contextMenu.id;
    contextMenu = null;
    render();
  });
  const duplicateButton = document.querySelector('#duplicate-node');
  if (duplicateButton) duplicateButton.addEventListener('click', async () => {
    const node = contextMenu;
    contextMenu = null;
    try {
      const copy = await fetch(`${API_URL}/${node.id}/duplicate`, { method: 'POST' }).then((response) => response.ok ? response.json() : Promise.reject());
      nodes.push(copy);
      selectedId = copy.id;
      pingFeedback = `${copy.name} created.`;
    } catch {
      pingFeedback = `Could not duplicate ${node.name}.`;
    }
    render();
  });
  const deleteMenuButton = document.querySelector('#delete-node-menu');
  if (deleteMenuButton) deleteMenuButton.addEventListener('click', async () => {
    const node = contextMenu;
    contextMenu = null;
    if (!window.confirm(`Delete ${node.name}?`)) { render(); return; }
    const response = await fetch(`${API_URL}/${node.id}`, { method: 'DELETE' });
    if (response.ok) {
      nodes = nodes.filter((item) => item.id !== node.id);
      selectedId = nodes[0]?.id || '';
    } else pingFeedback = `Could not delete ${node.name}.`;
    render();
  });
  window.addEventListener('pointermove', moveNode);
  window.addEventListener('pointerup', () => {
    if (dragging) {
      const node = nodes.find((item) => item.id === dragging.id);
      fetch(`${API_URL}/${node.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: node.x, y: node.y }) }).catch(() => {});
    }
    dragging = null;
  });
  document.querySelectorAll('.tool').forEach((tool) => tool.addEventListener('dragstart', (event) => event.dataTransfer.setData('node-type', tool.dataset.type)));
  canvas.addEventListener('dragover', (event) => event.preventDefault());
  canvas.addEventListener('drop', (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('node-type');
    if (!type) return;
    const bounds = canvas.getBoundingClientRect();
    const device = { id: `device-${Date.now()}`, name: `New ${nodeTypes[type].label}`, type, x: ((event.clientX - bounds.left) / bounds.width) * 100, y: ((event.clientY - bounds.top) / bounds.height) * 100, status: 'healthy', ip: '192.168.88.200', uptime: '100%', rx: 0, tx: 0 };
    nodes.push(device); selectedId = device.id; fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(device) }).catch(() => {}); render();
  });
  document.querySelector('#add-device').addEventListener('click', () => {
    const device = { id: `device-${Date.now()}`, name: 'New Device', type: 'device', x: 50, y: 55, status: 'healthy', ip: '192.168.88.200', uptime: '100%', rx: 0, tx: 0 };
    nodes.push(device); selectedId = device.id; fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(device) }).catch(() => {}); render();
  });
  document.querySelector('#fit-map').addEventListener('click', () => { nodes = nodes.map((node) => ({ ...node })); render(); });
  document.querySelector('#connect-mode').addEventListener('click', () => {
    if (linking) { linking = null; interfaceOptions = []; render(); return; }
    linking = { step: 'source', sourceId: selectedId || nodes[0]?.id };
    interfaceOptions = [];
    render();
    loadInterfaces(linking.sourceId);
  });
  const sourceSelect = document.querySelector('#link-source');
  if (sourceSelect) sourceSelect.addEventListener('change', (event) => {
    if (linking) linking.sourceId = event.target.value;
    loadInterfaces(event.target.value);
  });
  const linkForm = document.querySelector('#link-form');
  if (linkForm) {
    linkForm.addEventListener('focusin', () => { editingLink = true; });
    linkForm.addEventListener('submit', (event) => { event.preventDefault(); editingLink = false; linking = { ...Object.fromEntries(new FormData(event.currentTarget)), step: 'target' }; render(); });
  }
  const cancelLink = document.querySelector('#cancel-link');
  if (cancelLink) cancelLink.addEventListener('click', () => { editingLink = false; linking = null; selectedLinkId = ''; render(); });
  const editLinkForm = document.querySelector('#edit-link-form');
  if (editLinkForm) {
    editLinkForm.addEventListener('focusin', () => { editingLink = true; });
    editLinkForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const updated = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch(`/api/links/${selectedLinkId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      if (response.ok) { const link = await response.json(); links = links.map((item) => item.id === link.id ? link : item); }
      editingLink = false;
      selectedLinkId = '';
      render();
    });
  }
  document.querySelector('#device-actions').addEventListener('click', () => {
    actionsMenuOpen = !actionsMenuOpen;
    render();
  });
  const deleteButton = document.querySelector('#delete-device');
  if (deleteButton) deleteButton.addEventListener('click', async () => {
    if (!window.confirm(`Delete ${nodes.find((node) => node.id === selectedId).name}?`)) return;
    const response = await fetch(`${API_URL}/${selectedId}`, { method: 'DELETE' });
    if (!response.ok) {
      settingsFeedback = 'Could not delete device. Check the monitoring service.';
      actionsMenuOpen = false;
      render();
      return;
    }
    nodes = nodes.filter((node) => node.id !== selectedId);
    selectedId = nodes[0]?.id || '';
    actionsMenuOpen = false;
    render();
  });
  document.querySelector('#device-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const settings = Object.fromEntries(new FormData(event.currentTarget));
    if (!settings.name.trim() || !settings.ip.trim()) {
      settingsFeedback = 'Name and IP address are required.';
      editingSettings = false;
      render();
      return;
    }
    settingsFeedback = 'Saving settings...';
    render();
    try {
      const response = await fetch(`${API_URL}/${selectedId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      if (!response.ok) throw new Error();
      const savedNode = await response.json();
      nodes = nodes.map((node) => node.id === selectedId ? { ...node, ...savedNode, type: settings.type } : node);
      settingsFeedback = 'Settings saved.';
    } catch {
      settingsFeedback = 'Could not save settings. Check the monitoring service.';
    }
    settingsDraft = null;
    editingSettings = false;
    render();
  });
  document.querySelectorAll('#device-form input').forEach((input) => {
    input.addEventListener('focus', () => { editingSettings = true; });
    input.addEventListener('input', (event) => {
      settingsDraft = { id: selectedId, ...Object.fromEntries(new FormData(document.querySelector('#device-form'))), [event.target.name]: event.target.value };
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!document.querySelector('#device-form :focus')) editingSettings = false;
      }, 0);
    });
  });
}

function moveNode(event) {
  if (!dragging) return;
  const canvas = document.querySelector('#canvas');
  const bounds = canvas.getBoundingClientRect();
  const node = nodes.find((item) => item.id === dragging.id);
  node.x = Math.min(94, Math.max(6, dragging.x + ((event.clientX - dragging.startX) / bounds.width) * 100));
  node.y = Math.min(91, Math.max(6, dragging.y + ((event.clientY - dragging.startY) / bounds.height) * 100));
  const element = document.querySelector(`[data-id="${node.id}"]`);
  element.style.left = `${node.x}%`; element.style.top = `${node.y}%`;
  drawLinks();
}

function bindWorkspaceEvents() {
  const menuToggle = document.querySelector('#workspace-menu-toggle');
  if (menuToggle) menuToggle.addEventListener('click', () => { workspaceMenuOpen = !workspaceMenuOpen; render(); });
  const renameButton = document.querySelector('#rename-workspace');
  if (renameButton) renameButton.addEventListener('click', () => { workspaceMenuOpen = false; editingWorkspaceName = true; render(); document.querySelector('#workspace-name-input')?.focus(); });
  const exportButton = document.querySelector('#export-workspace');
  if (exportButton) exportButton.addEventListener('click', async () => { workspaceMenuOpen = false; await exportWorkspace(); render(); });
  const importButton = document.querySelector('#import-workspace');
  const importInput = document.querySelector('#import-workspace-input');
  if (importButton && importInput) importButton.addEventListener('click', () => { workspaceMenuOpen = false; render(); document.querySelector('#import-workspace-input').click(); });
  if (importInput) importInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) await importWorkspace(file);
    event.target.value = '';
  });
  const renameForm = document.querySelector('#workspace-rename-form');
  if (renameForm) renameForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.querySelector('#workspace-name-input').value.trim();
    if (!name) { editingWorkspaceName = false; render(); return; }
    try {
      const response = await fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error();
      workspaceName = (await response.json()).name;
    } catch {
      workspaceFeedback = 'Could not rename workspace.';
      setTimeout(() => { workspaceFeedback = ''; render(); }, 4000);
    }
    editingWorkspaceName = false;
    render();
  });
  const cancelRename = document.querySelector('#cancel-workspace-rename');
  if (cancelRename) cancelRename.addEventListener('click', () => { editingWorkspaceName = false; render(); });
}

async function loadWorkspaceName() {
  try {
    const workspace = await fetch('/api/workspace').then((response) => response.ok ? response.json() : Promise.reject());
    workspaceName = workspace.name;
    render();
  } catch {
    // Keep the default workspace name while the API is unavailable.
  }
}

async function exportWorkspace() {
  try {
    const bundle = await fetch('/api/workspace/export').then((response) => response.ok ? response.json() : Promise.reject());
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${bundle.workspace.name.replace(/[^a-z0-9-]+/gi, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    workspaceFeedback = 'Could not export workspace.';
    setTimeout(() => { workspaceFeedback = ''; render(); }, 4000);
  }
}

async function importWorkspace(file) {
  try {
    const payload = JSON.parse(await file.text());
    const response = await fetch('/api/workspace/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error((await response.json()).error || 'Import failed.');
    const result = await response.json();
    workspaceName = result.workspace.name;
    nodes = result.nodes;
    links = result.links;
    selectedId = nodes[0]?.id || '';
    workspaceFeedback = 'Workspace imported.';
  } catch (error) {
    workspaceFeedback = error instanceof SyntaxError ? 'Invalid workspace file.' : 'Could not import workspace.';
  }
  render();
  setTimeout(() => { workspaceFeedback = ''; render(); }, 4000);
}

async function refreshMetrics() {
  if (editingSettings || editingLink || refreshInFlight) return;
  refreshInFlight = true;
  try {
    const metrics = await fetch(API_URL).then((response) => response.ok ? response.json() : Promise.reject());
    const metricsById = new Map(metrics.map((metric) => [metric.id, metric]));
    nodes = nodes.map((node) => ({ ...node, ...metricsById.get(node.id) }));
    metrics.forEach((metric) => {
      if (!nodes.some((node) => node.id === metric.id)) nodes.push(metric);
    });
    links = await fetch('/api/links').then((response) => response.ok ? response.json() : Promise.reject());
    render();
  } catch {
    // The canvas remains usable with its initial sample data while the API is unavailable.
  } finally {
    refreshInFlight = false;
  }
}

setInterval(refreshMetrics, 1000);

render();
loadWorkspaceName();
refreshMetrics();