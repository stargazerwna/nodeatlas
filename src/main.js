import './style.css';

// In the packaged desktop app the backend runs on its own port (see electron/main.js);
// the web app keeps hitting same-origin/proxied "/api" paths as before.
const apiPort = new URLSearchParams(window.location.search).get('apiPort');
if (apiPort) {
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => (typeof input === 'string' && input.startsWith('/api') ? nativeFetch(apiBase + input, init) : nativeFetch(input, init));
}

const nodeTypes = {
  router: { icon: '◆', label: 'Router', className: 'router' },
  gateway: { icon: '↗', label: 'Gateway', className: 'gateway' },
  server: { icon: '▣', label: 'Server', className: 'server' },
  camera: { icon: '◉', label: 'Camera', className: 'camera' },
  device: { icon: '◇', label: 'Device', className: 'device' },
};

let nodes = [
  { id: 'mikrotik', name: 'MikroTik Router', type: 'router', x: 50, y: 20, status: 'healthy', ip: '192.168.88.1', uptime: '99.99%', rx: 12.4, tx: 8.1 },
  { id: 'accesspoint', name: 'OpenWRT Access Point', type: 'router', x: 28, y: 68, status: 'healthy', ip: '192.168.1.1', uptime: '99.95%', rx: 6.2, tx: 3.4 },
  { id: 'dvr', name: 'DVR', type: 'camera', x: 72, y: 68, status: 'healthy', ip: '192.168.1.10', uptime: '99.90%', rx: 2.1, tx: 0.6 },
];

let links = [];
let selectedId = 'mikrotik';
let selectedNodeIds = new Set();
let dragging = null;
let panning = null;
let selecting = null;
let settingsFeedback = '';
let actionsMenuOpen = false;
let editingSettings = false;
let settingsDraft = null;
let linking = null;
let selectedLinkId = '';
let contextMenu = null;
let pingFeedback = '';
let refreshInFlight = false;
let nodesLoading = false;
let deletingNodes = false;
let loadedNodeCount = 0;
let interfaceOptions = [];
let editingLink = false;
let workspaceName = 'myWorkspace';
let workspaceMenuOpen = false;
let editingWorkspaceName = false;
let workspaceFeedback = '';
let windImportProgress = null;
let windImportProgressTimer = null;
let zoom = 1;
let sidebarWidth = 224;
let inspectorWidth = 310;
let inspectorCollapsed = false;
let resizingPanel = null;
let resizingCanvas = null;
let discovery = null;
const API_URL = '/api/nodes';
const MAX_VISIBLE_NODES = 5000;
let nodeFilter = 'infrastructure';

const app = document.querySelector('#app');

document.addEventListener('contextmenu', (event) => event.preventDefault());

function statusLabel(status) {
  return status === 'healthy' ? 'Online' : status === 'warning' ? 'Degraded' : 'Offline';
}

function isClientNode(node) {
  return node.windType === 'client' || node.type === 'client' || node.kind === 'client';
}

function isAccessPointNode(node) {
  return ['ap', 'p2p-ap', 'access-point', 'accesspoint'].includes(String(node.windType || node.kind || node.type).toLowerCase());
}

function visibleNodes() {
  const filtered = nodeFilter === 'access-points'
    ? nodes.filter(isAccessPointNode)
    : nodeFilter === 'all'
      ? nodes
      : nodes.filter((node) => !isClientNode(node));
  return filtered.slice(0, MAX_VISIBLE_NODES);
}

function render() {
  const previousWrap = document.querySelector('#canvas-wrap');
  const scrollLeft = previousWrap?.scrollLeft || 0;
  const scrollTop = previousWrap?.scrollTop || 0;
  const selected = nodes.find((node) => node.id === selectedId) || nodes[0];
  const displayedNodes = visibleNodes();
  if (!nodeTypes[selected.type]) selected.type = 'device';
  const formValues = settingsDraft?.id === selected.id ? settingsDraft : selected;
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="https://wna.gr/nodesatlas" target="_blank" rel="noreferrer"><span class="brand-mark">N</span><span>Nodes<span>Atlas</span></span></a>
      ${renderSiteSwitcher()}
      <div class="top-actions"><span class="live"><i></i> LIVE</span><button class="icon-button" title="Notifications">♧<b>2</b></button><button class="avatar" title="Account">SA</button></div>
    </header>
    <main class="workspace" style="grid-template-columns:${sidebarWidth}px 6px minmax(400px,1fr) ${inspectorCollapsed ? '0px' : `6px ${inspectorWidth}px`}">
      <aside class="sidebar">
        <div class="nav-section"><span class="section-label">WORKSPACE</span><button class="nav-item active">⌘ <span>Topology</span></button><button class="nav-item">◴ <span>Events</span><em>12</em></button><button class="nav-item">▥ <span>Reports</span></button></div>
        <div class="nav-section palette"><span class="section-label">ADD TO MAP</span>${Object.entries(nodeTypes).map(([key, item]) => `<button class="tool" draggable="true" data-type="${key}"><span class="tool-icon ${item.className}">${item.icon}</span>${item.label}<small>Drag</small></button>`).join('')}</div>
        <div class="sidebar-footer"><span>VISIBLE HOSTS</span><strong>${displayedNodes.length}</strong><div class="health-bar"><i></i><i></i><i></i><i class="down"></i></div><small>${nodes.length.toLocaleString()} loaded</small></div>
      </aside>
      <div class="resize-handle" id="sidebar-handle"></div>
      <section class="content">
        <div class="canvas-toolbar"><div><h1>Site topology</h1><p>Live infrastructure overview <span>Updated just now</span></p>${nodesLoading ? `<div class="nodes-loader" role="status" aria-live="polite"><div class="nodes-loader-label"><span>Loading nodes...</span><strong>${loadedNodeCount ? loadedNodeCount.toLocaleString() : ''}</strong></div><div class="nodes-loader-track"><i></i></div></div>` : deletingNodes ? `<div class="nodes-loader" role="status" aria-live="polite"><div class="nodes-loader-label"><span>Deleting ${selectedNodeIds.size} nodes...</span><strong>Please wait</strong></div><div class="nodes-loader-track"><i></i></div></div>` : ''}</div><div class="toolbar-actions"><label class="node-filter">SHOW <select id="node-filter" ${deletingNodes ? 'disabled' : ''}><option value="infrastructure" ${nodeFilter === 'infrastructure' ? 'selected' : ''}>Nodes only</option><option value="access-points" ${nodeFilter === 'access-points' ? 'selected' : ''}>Access points</option><option value="all" ${nodeFilter === 'all' ? 'selected' : ''}>All nodes</option></select></label>${selectedNodeIds.size ? `<button class="outline-btn delete-selection" id="delete-selection" ${deletingNodes ? 'disabled' : ''}>× <span>${deletingNodes ? 'Deleting...' : `Delete ${selectedNodeIds.size} device${selectedNodeIds.size === 1 ? '' : 's'}`}</span></button>` : ''}${inspectorCollapsed ? '<button class="outline-btn" id="show-inspector" title="Show device details">▤</button>' : ''}<button class="outline-btn" id="fit-map">⊙</button><button class="outline-btn" id="discover-toolbar" title="Discover CDP, LLDP, or MNDP neighbors">⌕ <span>Discover</span></button><button class="outline-btn ${linking ? 'selected-tool' : ''}" id="connect-mode">⌁ <span>${linking ? 'Select target' : 'Connect'}</span></button><button class="primary-btn" id="add-device">＋ <span>Device</span></button></div></div>
        <div class="canvas-wrap" id="canvas-wrap">
          <div class="canvas" id="canvas" style="width:${zoom * 100}%;height:${zoom * 100}%">
            <svg class="links" id="links" aria-hidden="true"></svg>
            <div class="selection-marquee" id="selection-marquee" aria-hidden="true"></div>
            ${displayedNodes.map((node) => renderNode(node)).join('')}
            <div class="canvas-hint">Drag empty space to select <span>·</span> Middle-drag to pan <span>·</span> Press Delete to remove selected devices</div>
            <div class="canvas-resize-handle" id="canvas-resize-handle" title="Resize canvas area"></div>
          </div>
        </div>
      </section>
      ${inspectorCollapsed ? '' : '<div class="resize-handle" id="inspector-handle"></div>'}
      ${inspectorCollapsed ? '' : `<aside class="inspector">
        <div class="inspector-heading"><span>DEVICE DETAILS</span><button class="close-inspector" title="Close inspector">×</button></div>
        <div class="device-hero"><div class="large-icon ${nodeTypes[selected.type].className}">${nodeTypes[selected.type].icon}</div><div><h2>${selected.name}</h2><p><span class="status-dot ${selected.status}"></span>${statusLabel(selected.status)}</p></div><div class="device-actions"><button class="more" id="device-actions" title="More device actions" aria-expanded="${actionsMenuOpen}">•••</button>${actionsMenuOpen ? '<button class="delete-device" id="delete-device">Delete device</button>' : ''}</div></div>
        <div class="snmp-identity"><span>SNMP SYSTEM NAME</span><strong>${selected.systemName || '--'}</strong>${selected.platformVersion ? `<small>${selected.platformVersion}</small>` : ''}</div>
        <form class="device-settings" id="device-form"><label><span>DEVICE NAME</span><input name="name" value="${formValues.name}" aria-label="Device name" /></label><label><span>DEVICE TYPE</span><select name="type" aria-label="Device type">${Object.entries(nodeTypes).map(([key, item]) => `<option value="${key}" ${formValues.type === key ? 'selected' : ''}>${item.label}</option>`).join('')}</select></label><label><span>ROUTER PLATFORM</span><select name="platform" aria-label="Router platform"><option value="other" ${formValues.platform === 'other' ? 'selected' : ''}>Other / standard SNMP</option><option value="mikrotik" ${formValues.platform === 'mikrotik' ? 'selected' : ''}>MikroTik RouterOS</option><option value="openwrt" ${formValues.platform === 'openwrt' ? 'selected' : ''}>OpenWRT</option></select></label><label><span>IP ADDRESS</span><input name="ip" value="${formValues.ip}" aria-label="IP address" spellcheck="false" /></label><label><span>SNMP COMMUNITY</span><input name="community" type="password" placeholder="Keep current value" aria-label="SNMP community" autocomplete="new-password" /></label><label><span>SNMP PORT</span><input name="port" type="number" min="1" max="65535" value="${formValues.port || 161}" aria-label="SNMP port" /></label><button class="save-settings" type="submit">Save settings</button><p class="settings-feedback ${settingsFeedback.startsWith('Could not') ? 'error' : ''}" aria-live="polite">${settingsFeedback}</p></form>
        <div class="property-grid"><div><span>UPTIME</span><strong>${selected.uptime || '--'}</strong></div><div><span>LATENCY</span><strong>${selected.status === 'offline' ? '--' : `${selected.latency || 12} ms`}</strong></div><div><span>PACKET LOSS</span><strong>${selected.status === 'offline' ? '--' : selected.status === 'warning' ? '2.8%' : '0.0%'}</strong></div></div>
        <div class="metric"><div><span>CPU UTILIZATION</span><strong>${selected.cpu ?? '--'}${selected.cpu === undefined ? '' : '%'}</strong></div><div class="meter"><i style="width:${selected.cpu ?? 0}%"></i></div></div>
        <div class="metric"><div><span>MEMORY</span><strong>${selected.memory ?? '--'}${selected.memory === undefined ? '' : '%'}</strong></div><div class="meter teal"><i style="width:${selected.memory ?? 0}%"></i></div></div>
        <div class="traffic-title"><span>TRAFFIC</span><button>24H ⌄</button></div><div class="chart"><svg viewBox="0 0 280 100" preserveAspectRatio="none"><path d="M0 83 L12 77 L25 80 L38 58 L52 68 L66 42 L79 54 L93 27 L106 46 L120 39 L134 64 L148 45 L161 57 L175 31 L188 43 L202 25 L216 49 L229 40 L242 62 L255 53 L268 72 L280 58 V100 H0Z"></path><polyline points="0,83 12,77 25,80 38,58 52,68 66,42 79,54 93,27 106,46 120,39 134,64 148,45 161,57 175,31 188,43 202,25 216,49 229,40 242,62 255,53 268,72 280,58"></polyline></svg><div class="chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>NOW</span></div></div>
        <button class="event-button">View device events <span>→</span></button>
      </aside>`}
      ${linking?.step === 'source' ? renderLinkDialog() : ''}${renderLinkEditor()}${renderContextMenu()}${renderDiscoveryDialog()}${pingFeedback ? `<div class="ping-feedback">${pingFeedback}</div>` : ''}
    </main>`;
  bindEvents();
  drawLinks();
  const wrap = document.querySelector('#canvas-wrap');
  if (wrap) { wrap.scrollLeft = scrollLeft; wrap.scrollTop = scrollTop; }
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
  return `<div class="node-menu" style="left:${contextMenu.x}px;top:${contextMenu.y}px"><button id="open-node-settings">⚙ <span>Settings</span></button><button id="duplicate-node">▣ <span>Duplicate</span></button><button id="ping-node">⌁ <span>Ping ${contextMenu.name}</span></button><button id="discover-node">⌕ <span>Discover neighbors</span></button><hr /><button class="danger" id="delete-node-menu">× <span>Delete device</span></button></div>`;
}

function renderDiscoveryDialog() {
  if (!discovery) return '';
  const body = discovery.loading
    ? '<p class="discovery-status">Scanning for neighbors…</p>'
    : discovery.error
      ? `<p class="discovery-status error">${discovery.error}</p>`
      : discovery.candidates.length === 0
        ? '<p class="discovery-status">No neighbors found. Make sure LLDP/CDP or MikroTik neighbor discovery is enabled on the device.</p>'
        : `<ul class="discovery-list">${discovery.candidates.map((candidate, index) => `<li><label><input type="checkbox" data-index="${index}" ${candidate.remoteIp ? '' : 'disabled'} /><span class="discovery-info"><strong>${candidate.remoteName || candidate.remoteIp || 'Unknown device'}</strong><small>${candidate.protocol}${candidate.remoteIp ? ` · ${candidate.remoteIp}` : ' · no IP reported'}${candidate.remotePlatform ? ` · ${candidate.remotePlatform}` : ''}</small></span></label></li>`).join('')}</ul>`;
  return `<div class="link-dialog"><form id="discovery-form"><h2>Discover neighbors of ${discovery.sourceName}</h2><label>Protocol<select name="protocol"><option value="all" ${discovery.protocol === 'all' ? 'selected' : ''}>CDP + LLDP + MNDP</option><option value="cdp" ${discovery.protocol === 'cdp' ? 'selected' : ''}>CDP</option><option value="lldp" ${discovery.protocol === 'lldp' ? 'selected' : ''}>LLDP</option><option value="mndp" ${discovery.protocol === 'mndp' ? 'selected' : ''}>MNDP</option></select></label>${body}<button class="primary-btn" type="submit" ${discovery.loading || discovery.error || !discovery.candidates?.length ? 'disabled' : ''}>Add selected devices</button><button class="cancel-link" type="button" id="cancel-discovery">Close</button></form></div>`;
}

function renderSiteSwitcher() {
  if (editingWorkspaceName) {
    return `<form class="site-switcher editing" id="workspace-rename-form"><span class="pulse"></span><input id="workspace-name-input" value="${workspaceName.replace(/"/g, '&quot;')}" maxlength="60" autocomplete="off" /><button type="submit" class="workspace-save" title="Save name">✓</button><button type="button" class="workspace-cancel" id="cancel-workspace-rename" title="Cancel">×</button></form>`;
  }
  const feedback = workspaceFeedback ? windImportProgress === null ? workspaceFeedback : `<div class="workspace-progress-label"><span>${workspaceFeedback}</span><strong>${windImportProgress}%</strong></div><div class="workspace-progress"><i style="width:${windImportProgress}%"></i></div>` : '';
  return `<div class="site-switcher"><button class="site-switcher-label" id="workspace-menu-toggle"><span class="pulse"></span> ${workspaceName} <span class="caret">⌄</span></button>${workspaceMenuOpen ? `<div class="workspace-menu"><button id="rename-workspace">✎ <span>Rename workspace</span></button><button id="export-workspace">⬇ <span>Export workspace</span></button><button id="import-workspace">⬆ <span>Import workspace</span></button><button id="import-wind">◎ <span>Import Wireless Nodes Database</span></button></div>` : ''}<input type="file" id="import-workspace-input" accept="application/json" hidden />${feedback ? `<div class="workspace-feedback">${feedback}</div>` : ''}</div>`;
}

function renderNode(node) {
  const type = nodeTypes[node.type];
  const traffic = `↓ ${node.rx} Mbps  ↑ ${node.tx} Mbps`;
  const detail = node.status === 'offline' ? (node.pingReachable ? `Ping ${node.pingLatency === null ? 'OK' : `${node.pingLatency} ms`}` : 'SNMP unavailable') : traffic;
  const stateClass = node.status === 'offline' && node.pingReachable ? 'ping-ok' : node.status;
  const hasHealth = node.status !== 'offline' && (node.cpu !== undefined || node.memory !== undefined);
  const health = hasHealth ? `<small class="node-health">${node.cpu !== undefined ? `CPU ${node.cpu}%` : ''}${node.cpu !== undefined && node.memory !== undefined ? ' · ' : ''}${node.memory !== undefined ? `MEM ${node.memory}%` : ''}</small>` : '';
  return `<button class="map-node ${stateClass} ${selectedNodeIds.has(node.id) ? 'is-selected' : ''}" data-id="${node.id}" style="left:${node.x}%;top:${node.y}%"><span class="node-icon ${type.className}">${type.icon}</span><span class="node-copy"><strong>${node.name}</strong><small>${detail}</small>${health}</span><span class="node-state"></span></button>`;
}

function updateNodeElements() {
  const elements = new Map([...document.querySelectorAll('.map-node')].map((element) => [element.dataset.id, element]));
  nodes.forEach((node) => {
    const element = elements.get(node.id);
    if (!element) return;
    const type = nodeTypes[node.type] || nodeTypes.device;
    const traffic = `↓ ${node.rx} Mbps  ↑ ${node.tx} Mbps`;
    const detail = node.status === 'offline' ? (node.pingReachable ? `Ping ${node.pingLatency === null ? 'OK' : `${node.pingLatency} ms`}` : 'SNMP unavailable') : traffic;
    const stateClass = node.status === 'offline' && node.pingReachable ? 'ping-ok' : node.status;
    const hasHealth = node.status !== 'offline' && (node.cpu !== undefined || node.memory !== undefined);
    const health = hasHealth ? `${node.cpu !== undefined ? `CPU ${node.cpu}%` : ''}${node.cpu !== undefined && node.memory !== undefined ? ' · ' : ''}${node.memory !== undefined ? `MEM ${node.memory}%` : ''}` : '';
    element.className = `map-node ${stateClass} ${selectedNodeIds.has(node.id) ? 'is-selected' : ''}`;
    element.style.left = `${node.x}%`;
    element.style.top = `${node.y}%`;
    const icon = element.querySelector('.node-icon');
    icon.className = `node-icon ${type.className}`;
    icon.textContent = type.icon;
    const copy = element.querySelector('.node-copy');
    copy.querySelector('strong').textContent = node.name;
    copy.querySelector('small').textContent = detail;
    const healthElement = copy.querySelector('.node-health');
    if (health) {
      if (healthElement) healthElement.textContent = health;
      else copy.insertAdjacentHTML('beforeend', `<small class="node-health">${health}</small>`);
    } else healthElement?.remove();
  });
}

function drawLinks() {
  const svg = document.querySelector('#links');
  const displayedIds = new Set(visibleNodes().map((node) => node.id));
  svg.innerHTML = links.map((link) => {
    if (!displayedIds.has(link.sourceId) || !displayedIds.has(link.targetId)) return '';
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

async function startDiscovery(node, protocol) {
  if (!node) return;
  discovery = { sourceId: node.id, sourceName: node.name, protocol, candidates: [], loading: true, error: '' };
  render();
  try {
    const response = await fetch(`${API_URL}/${node.id}/discover-neighbors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocol }) });
    if (!response.ok) throw new Error();
    const result = await response.json();
    discovery = { ...discovery, loading: false, candidates: result.candidates || [] };
  } catch {
    discovery = { ...discovery, loading: false, error: `Could not discover neighbors of ${node.name}. Check the monitoring service.` };
  }
  render();
}

async function createNode(device) {
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(device) });
    if (!response.ok) throw new Error('Could not save device.');
    const saved = await response.json();
    nodes = nodes.map((node) => node.id === device.id ? saved : node);
    render();
  } catch (error) {
    nodes = nodes.filter((node) => node.id !== device.id);
    selectedId = nodes[0]?.id || '';
    pingFeedback = error.message;
    render();
  }
}

function bindEvents() {
  bindWorkspaceEvents();
  const canvas = document.querySelector('#canvas');
  document.querySelector('#node-filter')?.addEventListener('change', (event) => {
    nodeFilter = event.target.value;
    selectedNodeIds = new Set([...selectedNodeIds].filter((id) => visibleNodes().some((node) => node.id === id)));
    render();
    refreshMetrics();
  });
  const deleteSelectionButton = document.querySelector('#delete-selection');
  if (deleteSelectionButton) deleteSelectionButton.addEventListener('click', deleteSelectedNodes);
  document.querySelector('#links').addEventListener('click', (event) => {
    if (event.target.dataset.linkId) { selectedLinkId = event.target.dataset.linkId; render(); }
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.target.closest('#canvas-resize-handle')) {
      resizingCanvas = { startX: event.clientX, startWidth: canvas.getBoundingClientRect().width, startZoom: zoom, nextZoom: zoom };
      return;
    }
    const nodeElement = event.target.closest('.map-node');
    if (!nodeElement) {
      if (linking || (event.button !== 0 && event.button !== 1)) return;
      if (event.button === 1) {
        const wrap = document.querySelector('#canvas-wrap');
        panning = { startX: event.clientX, startY: event.clientY, scrollLeft: wrap.scrollLeft, scrollTop: wrap.scrollTop };
        wrap.style.cursor = 'grabbing';
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      selecting = { startX: event.clientX - bounds.left, startY: event.clientY - bounds.top, canvas };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
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
    selectedNodeIds = new Set([node.id]);
    inspectorCollapsed = false;
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
  const discoverButton = document.querySelector('#discover-node');
  if (discoverButton) discoverButton.addEventListener('click', async () => {
    const node = contextMenu;
    contextMenu = null;
    startDiscovery(node, 'all');
  });
  const discoverToolbar = document.querySelector('#discover-toolbar');
  if (discoverToolbar) discoverToolbar.addEventListener('click', () => startDiscovery(nodes.find((node) => node.id === selectedId) || nodes.find((node) => node.type === 'router' || node.type === 'gateway') || nodes[0], 'all'));
  const cancelDiscovery = document.querySelector('#cancel-discovery');
  if (cancelDiscovery) cancelDiscovery.addEventListener('click', () => { discovery = null; render(); });
  const discoveryForm = document.querySelector('#discovery-form');
  const discoveryProtocol = discoveryForm?.querySelector('select[name="protocol"]');
  if (discoveryProtocol) discoveryProtocol.addEventListener('change', () => startDiscovery(nodes.find((node) => node.id === discovery.sourceId), discoveryProtocol.value));
  if (discoveryForm) discoveryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const source = nodes.find((item) => item.id === discovery.sourceId);
    const chosen = [...discoveryForm.querySelectorAll('input[type="checkbox"]:checked')].map((input) => discovery.candidates[Number(input.dataset.index)]);
    if (!source || !chosen.length) { discovery = null; render(); return; }
    let created = 0;
    for (const [index, candidate] of chosen.entries()) {
      if (nodes.some((node) => node.ip === candidate.remoteIp)) continue;
      const device = {
        id: `neighbor-${Date.now()}-${index}`,
        name: candidate.remoteName || candidate.remoteIp,
        type: 'router',
        platform: /mikrotik|routeros/i.test(candidate.remotePlatform || '') ? 'mikrotik' : 'other',
        ip: candidate.remoteIp,
        x: Math.min(94, Math.max(6, (source.x || 50) + (index % 2 === 0 ? 8 : -8))),
        y: Math.min(91, Math.max(6, (source.y || 50) + 10 + index * 6)),
      };
      try {
        const saved = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(device) }).then((response) => response.ok ? response.json() : Promise.reject());
        nodes.push(saved);
        created += 1;
        if (candidate.localInterfaceIndex) {
          const link = await fetch('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: source.id, targetId: saved.id, interfaceIndex: candidate.localInterfaceIndex }) }).then((response) => response.ok ? response.json() : null);
          if (link) links.push(link);
        }
      } catch {
        // Skip devices that failed to save (e.g. duplicate IP) and continue with the rest.
      }
    }
    pingFeedback = created ? `Added ${created} discovered device${created === 1 ? '' : 's'}.` : 'Could not add the selected devices.';
    discovery = null;
    render();
    setTimeout(() => { pingFeedback = ''; render(); }, 4000);
  });
  window.addEventListener('pointermove', moveNode);
  window.addEventListener('pointerup', () => {
    if (dragging) {
      const node = nodes.find((item) => item.id === dragging.id);
      fetch(`${API_URL}/${node.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: node.x, y: node.y }) }).catch(() => {});
    }
    dragging = null;
    if (selecting) {
      selecting = null;
      render();
    }
    if (panning) document.querySelector('#canvas-wrap').style.cursor = '';
    panning = null;
    if (resizingPanel) {
      document.querySelector(`#${resizingPanel.panel}-handle`)?.classList.remove('active');
      resizingPanel = null;
      render();
    }
    if (resizingCanvas) {
      zoom = resizingCanvas.nextZoom;
      resizingCanvas = null;
      render();
    }
  });
  document.querySelectorAll('.tool').forEach((tool) => tool.addEventListener('dragstart', (event) => event.dataTransfer.setData('node-type', tool.dataset.type)));
  canvas.addEventListener('dragover', (event) => event.preventDefault());
  canvas.addEventListener('drop', (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('node-type');
    if (!type) return;
    const bounds = canvas.getBoundingClientRect();
    const device = { id: `device-${Date.now()}`, name: `New ${nodeTypes[type].label}`, type, x: ((event.clientX - bounds.left) / bounds.width) * 100, y: ((event.clientY - bounds.top) / bounds.height) * 100, status: 'healthy', ip: '192.168.88.200', uptime: '100%', rx: 0, tx: 0 };
    nodes.push(device); selectedId = device.id; render(); createNode(device);
  });
  document.querySelector('#add-device').addEventListener('click', () => {
    const device = { id: `device-${Date.now()}`, name: 'New Device', type: 'device', x: 50, y: 55, status: 'healthy', ip: '192.168.88.200', uptime: '100%', rx: 0, tx: 0 };
    nodes.push(device); selectedId = device.id; render(); createNode(device);
  });
  document.querySelector('#fit-map').addEventListener('click', () => { zoom = 1; render(); });
  document.querySelector('#canvas-wrap').addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom = Math.min(2.5, Math.max(0.5, +(zoom + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(2)));
    render();
  }, { passive: false });
  const closeInspector = document.querySelector('.close-inspector');
  if (closeInspector) closeInspector.addEventListener('click', () => { inspectorCollapsed = true; render(); });
  const showInspector = document.querySelector('#show-inspector');
  if (showInspector) showInspector.addEventListener('click', () => { inspectorCollapsed = false; render(); });
  const sidebarHandle = document.querySelector('#sidebar-handle');
  if (sidebarHandle) sidebarHandle.addEventListener('pointerdown', (event) => {
    resizingPanel = { panel: 'sidebar', startX: event.clientX, startWidth: sidebarWidth };
    sidebarHandle.classList.add('active');
  });
  const inspectorHandle = document.querySelector('#inspector-handle');
  if (inspectorHandle) inspectorHandle.addEventListener('pointerdown', (event) => {
    resizingPanel = { panel: 'inspector', startX: event.clientX, startWidth: inspectorWidth };
    inspectorHandle.classList.add('active');
  });
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
  const deviceActions = document.querySelector('#device-actions');
  if (deviceActions) deviceActions.addEventListener('click', () => {
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
  const deviceForm = document.querySelector('#device-form');
  if (deviceForm) deviceForm.addEventListener('submit', async (event) => {
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
  if (resizingCanvas) {
    const delta = event.clientX - resizingCanvas.startX;
    resizingCanvas.nextZoom = Math.min(2.5, Math.max(0.5, +(resizingCanvas.startZoom * ((resizingCanvas.startWidth + delta) / resizingCanvas.startWidth)).toFixed(2)));
    const canvas = document.querySelector('#canvas');
    canvas.style.width = `${resizingCanvas.nextZoom * 100}%`;
    canvas.style.height = `${resizingCanvas.nextZoom * 100}%`;
    return;
  }
  if (resizingPanel) {
    const delta = event.clientX - resizingPanel.startX;
    const workspace = document.querySelector('.workspace');
    if (resizingPanel.panel === 'sidebar') {
      sidebarWidth = Math.min(420, Math.max(180, resizingPanel.startWidth + delta));
    } else {
      inspectorWidth = Math.min(560, Math.max(240, resizingPanel.startWidth - delta));
    }
    workspace.style.gridTemplateColumns = `${sidebarWidth}px 6px minmax(400px,1fr) 6px ${inspectorWidth}px`;
    return;
  }
  if (selecting) {
    const bounds = selecting.canvas.getBoundingClientRect();
    const currentX = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width);
    const currentY = Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height);
    const left = Math.min(selecting.startX, currentX);
    const top = Math.min(selecting.startY, currentY);
    const width = Math.abs(currentX - selecting.startX);
    const height = Math.abs(currentY - selecting.startY);
    const marquee = document.querySelector('#selection-marquee');
    marquee.style.left = `${left}px`;
    marquee.style.top = `${top}px`;
    marquee.style.width = `${width}px`;
    marquee.style.height = `${height}px`;
    marquee.classList.toggle('visible', width > 3 || height > 3);
    const marqueeBounds = marquee.getBoundingClientRect();
    selectedNodeIds = new Set(nodes.filter((node) => {
      const nodeBounds = document.querySelector(`[data-id="${node.id}"]`).getBoundingClientRect();
      return nodeBounds.left < marqueeBounds.right && nodeBounds.right > marqueeBounds.left && nodeBounds.top < marqueeBounds.bottom && nodeBounds.bottom > marqueeBounds.top;
    }).map((node) => node.id));
    if (selectedNodeIds.size) selectedId = [...selectedNodeIds][0];
    document.querySelectorAll('.map-node').forEach((node) => node.classList.toggle('is-selected', selectedNodeIds.has(node.dataset.id)));
    return;
  }
  if (panning) {
    const wrap = document.querySelector('#canvas-wrap');
    wrap.scrollLeft = panning.scrollLeft - (event.clientX - panning.startX);
    wrap.scrollTop = panning.scrollTop - (event.clientY - panning.startY);
    return;
  }
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

async function deleteSelectedNodes() {
  if (deletingNodes) return;
  const ids = [...selectedNodeIds];
  if (!ids.length || !window.confirm(`Delete ${ids.length} selected device${ids.length === 1 ? '' : 's'}?`)) return;
  deletingNodes = true;
  render();
  try {
    const results = await Promise.all(ids.map((id) => fetch(`${API_URL}/${id}`, { method: 'DELETE' }).then((response) => ({ id, ok: response.ok })).catch(() => ({ id, ok: false }))));
    const deletedIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
    nodes = nodes.filter((node) => !deletedIds.has(node.id));
    selectedNodeIds = new Set();
    selectedId = nodes[0]?.id || '';
    if (deletedIds.size !== ids.length) pingFeedback = `Could not delete ${ids.length - deletedIds.size} selected device${ids.length - deletedIds.size === 1 ? '' : 's'}.`;
  } finally {
    deletingNodes = false;
    render();
  }
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
  const windImportButton = document.querySelector('#import-wind');
  if (windImportButton) windImportButton.addEventListener('click', async () => {
    workspaceMenuOpen = false;
    const domain = window.prompt('Wireless Nodes Database domain name', 'www.wna.gr/wind');
    if (!domain?.trim()) { render(); return; }
    windImportProgress = 8;
    workspaceFeedback = 'Connecting to Wind...';
    render();
    windImportProgressTimer = setInterval(() => {
      if (windImportProgress < 88) {
        windImportProgress = Math.min(88, windImportProgress + 8);
        workspaceFeedback = windImportProgress < 48 ? 'Fetching Wind nodes...' : 'Parsing Wind nodes...';
        render();
      }
    }, 450);
    try {
      const response = await fetch('/api/integrations/wind/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: domain.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Wind import failed.');
      clearInterval(windImportProgressTimer);
      windImportProgress = 100;
      nodes = result.nodes;
      links = result.links || links;
      selectedId = nodes[0]?.id || '';
      workspaceFeedback = `Imported ${result.imported} Wind node${result.imported === 1 ? '' : 's'}${result.skipped ? `, skipped ${result.skipped} existing` : ''}; ${result.linked || 0} links added.`;
    } catch (error) {
      clearInterval(windImportProgressTimer);
      windImportProgress = null;
      workspaceFeedback = error.message || 'Could not import Wind nodes.';
    }
    render();
    setTimeout(() => { workspaceFeedback = ''; windImportProgress = null; render(); }, 5000);
  });
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
  nodesLoading = true;
  try {
    const metrics = await fetch(`${API_URL}?filter=${encodeURIComponent(nodeFilter)}&limit=${MAX_VISIBLE_NODES}`).then((response) => response.ok ? response.json() : Promise.reject());
    loadedNodeCount = metrics.length;
    const metricsById = new Map(metrics.map((metric) => [metric.id, metric]));
    nodes = nodes.map((node) => ({ ...node, ...metricsById.get(node.id) }));
    const nodeIds = new Set(nodes.map((node) => node.id));
    let addedNodes = false;
    metrics.forEach((metric) => {
      if (!nodeIds.has(metric.id)) {
        nodes.push(metric);
        addedNodes = true;
      }
    });
    links = await fetch('/api/links').then((response) => response.ok ? response.json() : Promise.reject());
    if (addedNodes) render();
    else updateNodeElements();
    drawLinks();
  } catch {
    // The canvas remains usable with its initial sample data while the API is unavailable.
  } finally {
    nodesLoading = false;
    refreshInFlight = false;
  }
}

setInterval(refreshMetrics, 1000);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Delete' || event.target.matches('input, select, textarea') || !selectedNodeIds.size) return;
  event.preventDefault();
  deleteSelectedNodes();
});

render();
loadWorkspaceName();
refreshMetrics();