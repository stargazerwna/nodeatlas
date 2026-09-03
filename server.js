import http from 'node:http';
import dgram from 'node:dgram';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import snmp from 'net-snmp';

// Resolve defaults relative to this file's own directory, not process.cwd() (which can be
// a temp extraction folder for packaged/portable builds and would otherwise break lookups).
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const CONFIG_PATH = process.env.NODES_CONFIG || path.join(moduleDir, 'nodes.local.json');
const SAMPLE_CONFIG_PATH = process.env.NODES_SAMPLE_CONFIG || path.join(moduleDir, 'nodes.example.json');
const LINKS_PATH = process.env.LINKS_CONFIG || path.join(moduleDir, 'links.local.json');
const SAMPLE_LINKS_PATH = process.env.LINKS_SAMPLE_CONFIG || path.join(moduleDir, 'links.example.json');
const WORKSPACE_PATH = process.env.WORKSPACE_CONFIG || path.join(moduleDir, 'workspace.local.json');
const OIDS = [
  '1.3.6.1.2.1.1.1.0', // sysDescr
  '1.3.6.1.2.1.1.5.0', // sysName
  '1.3.6.1.2.1.1.3.0', // sysUpTime
  '1.3.6.1.2.1.2.2.1.10.1', // ifInOctets.1
  '1.3.6.1.2.1.2.2.1.16.1', // ifOutOctets.1
];
const HEALTH_OIDS = [
  '1.3.6.1.4.1.2021.11.11.0', // ssCpuIdle (UCD-SNMP, used by net-snmp on OpenWrt/Linux)
  '1.3.6.1.4.1.2021.4.5.0', // memTotalReal
  '1.3.6.1.4.1.2021.4.6.0', // memAvailReal
];
// RouterOS does not implement UCD-SNMP; it exposes health via HOST-RESOURCES-MIB instead.
const MIKROTIK_CPU_OID = '1.3.6.1.2.1.25.3.3.1.2'; // hrProcessorLoad
const MIKROTIK_STORAGE_DESCR_OID = '1.3.6.1.2.1.25.2.3.1.3'; // hrStorageDescr
const MIKROTIK_STORAGE_SIZE_OID = '1.3.6.1.2.1.25.2.3.1.5'; // hrStorageSize
const MIKROTIK_STORAGE_USED_OID = '1.3.6.1.2.1.25.2.3.1.6'; // hrStorageUsed

let nodes = await loadNodes();
let snapshots = new Map();
let links = await loadLinks();
let workspace = await loadWorkspace();
const execFileAsync = promisify(execFile);

async function loadNodes() {
  const path = existsSync(CONFIG_PATH) ? CONFIG_PATH : SAMPLE_CONFIG_PATH;
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadLinks() {
  if (existsSync(LINKS_PATH)) return JSON.parse(await readFile(LINKS_PATH, 'utf8'));
  return existsSync(SAMPLE_LINKS_PATH) ? JSON.parse(await readFile(SAMPLE_LINKS_PATH, 'utf8')) : [];
}

async function loadWorkspace() {
  return existsSync(WORKSPACE_PATH) ? JSON.parse(await readFile(WORKSPACE_PATH, 'utf8')) : { name: 'myWorkspace' };
}

function formatUptime(ticks) {
  const totalMinutes = Math.floor(ticks / 6000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${totalMinutes % 60}m`;
}

function getPlatformVersion(description) {
  const routerOs = description.match(/RouterOS\s+v?([\w.-]+)/i);
  if (routerOs) return `RouterOS ${routerOs[1]}`;
  const openWrt = description.match(/OpenWrt\s+([\w.-]+)/i);
  if (openWrt) return `OpenWrt ${openWrt[1]}`;
  return '';
}

async function saveNodes() {
  await writeFile(CONFIG_PATH, `${JSON.stringify(nodes, null, 2)}\n`);
}

async function saveLinks() {
  await writeFile(LINKS_PATH, `${JSON.stringify(links, null, 2)}\n`);
}

async function saveWorkspace() {
  await writeFile(WORKSPACE_PATH, `${JSON.stringify(workspace, null, 2)}\n`);
}

function getInterfaceOid(index, direction) {
  return `1.3.6.1.2.1.2.2.1.${direction === 'rx' ? 10 : 16}.${index}`;
}

function getInterfaces(node) {
  return new Promise((resolve) => {
    const session = snmp.createSession(node.ip, node.community || process.env.SNMP_COMMUNITY || 'public', { port: Number(node.port || 161), timeout: Number(process.env.SNMP_TIMEOUT || 2000), retries: Number(process.env.SNMP_RETRIES || 1), version: snmp.Version2c });
    const interfaces = [];
    session.subtree('1.3.6.1.2.1.2.2.1.2', 20, (varbinds) => {
      interfaces.push(...varbinds.filter((varbind) => !snmp.isVarbindError(varbind)).map((varbind) => ({ index: Number(varbind.oid.split('.').pop()), name: String(varbind.value) })));
      return false;
    }, () => {
      session.close();
      resolve(interfaces);
    });
  });
}

function walkSnmp(node, oid) {
  return new Promise((resolve) => {
    const session = snmp.createSession(node.ip, node.community || process.env.SNMP_COMMUNITY || 'public', { port: Number(node.port || 161), timeout: Number(process.env.SNMP_TIMEOUT || 2000), retries: 0, version: snmp.Version2c });
    const varbinds = [];
    session.subtree(oid, 20, (items) => {
      varbinds.push(...items.filter((item) => !snmp.isVarbindError(item)));
      return false;
    }, () => {
      session.close();
      resolve(varbinds);
    });
  });
}

function oidSuffix(oid, base) {
  return oid.startsWith(`${base}.`) ? oid.slice(base.length + 1).split('.').map(Number) : [];
}

function valueText(value) {
  return Buffer.isBuffer(value) ? value.toString('utf8').replace(/\0/g, '').trim() : String(value ?? '').trim();
}

function valueIp(value) {
  const text = valueText(value);
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(text)) return text;
  if (Buffer.isBuffer(value) && value.length === 4) return [...value].join('.');
  return '';
}

async function discoverSnmpNeighbors(node, protocol) {
  const candidates = [];
  if (protocol === 'lldp' || protocol === 'all') {
    const base = '1.0.8802.1.1.2.1.4.1.1';
    const [names, descriptions, ports] = await Promise.all([
      walkSnmp(node, `${base}.9`), walkSnmp(node, `${base}.10`), walkSnmp(node, `${base}.8`),
    ]);
    const byKey = new Map();
    names.forEach((item) => {
      const suffix = oidSuffix(item.oid, `${base}.9`); const key = suffix.slice(0, -1).join('.');
      byKey.set(key, { protocol: 'LLDP', remoteName: valueText(item.value), localInterfaceIndex: Number(suffix[1]) || 0 });
    });
    descriptions.forEach((item) => { const key = oidSuffix(item.oid, `${base}.10`).slice(0, -1).join('.'); if (byKey.has(key)) byKey.get(key).remotePlatform = valueText(item.value); });
    ports.forEach((item) => { const key = oidSuffix(item.oid, `${base}.8`).slice(0, -1).join('.'); if (byKey.has(key)) byKey.get(key).remotePort = valueText(item.value); });
    // Remote management addresses live in a separate table (lldpRemManAddrTable) whose index
    // embeds the address bytes directly, rather than in a plain value column.
    const addrBase = '1.0.8802.1.1.2.1.4.2.1.3';
    (await walkSnmp(node, addrBase)).forEach((item) => {
      const suffix = oidSuffix(item.oid, addrBase); // timeMark, localPort, remIndex, addrSubtype, addrLen, ...addrBytes
      const key = suffix.slice(0, 2).join('.');
      const [, , , addrSubtype, addrLen] = suffix;
      if (addrSubtype === 1 && addrLen === 4 && byKey.has(key)) byKey.get(key).remoteIp = suffix.slice(5, 9).join('.');
    });
    candidates.push(...byKey.values());
  }
  if (protocol === 'cdp' || protocol === 'all') {
    const base = '1.3.6.1.4.1.9.9.23.1.2.1.1';
    const [ids, platforms, ports, addresses] = await Promise.all([
      walkSnmp(node, `${base}.6`), walkSnmp(node, `${base}.8`), walkSnmp(node, `${base}.7`), walkSnmp(node, `${base}.4`),
    ]);
    const byKey = new Map();
    ids.forEach((item) => { const suffix = oidSuffix(item.oid, `${base}.6`); const key = suffix.slice(0, -1).join('.'); byKey.set(key, { protocol: 'CDP', remoteName: valueText(item.value), localInterfaceIndex: Number(suffix[0]) || 0 }); });
    platforms.forEach((item) => { const key = oidSuffix(item.oid, `${base}.8`).slice(0, -1).join('.'); if (byKey.has(key)) byKey.get(key).remotePlatform = valueText(item.value); });
    ports.forEach((item) => { const key = oidSuffix(item.oid, `${base}.7`).slice(0, -1).join('.'); if (byKey.has(key)) byKey.get(key).remotePort = valueText(item.value); });
    addresses.forEach((item) => { const key = oidSuffix(item.oid, `${base}.4`).slice(0, -1).join('.'); if (byKey.has(key)) byKey.get(key).remoteIp = valueIp(item.value); });
    candidates.push(...byKey.values());
  }
  return candidates;
}

function discoverMndpNeighbors() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4'); const candidates = new Map();
    const finish = () => { clearTimeout(timer); try { socket.close(); } catch {} resolve([...candidates.values()]); };
    const timer = setTimeout(finish, 1800);
    socket.on('message', (message, remote) => {
      if (message.length < 4) return;
      let offset = 4; const fields = {};
      while (offset + 4 <= message.length) {
        const type = message.readUInt16LE(offset); const length = message.readUInt16LE(offset + 2); offset += 4;
        if (length < 4 || offset + length - 4 > message.length) break;
        const value = message.subarray(offset, offset + length - 4); offset += length - 4;
        fields[type] = value;
      }
      const remoteIp = valueIp(fields[11]) || remote.address;
      const remoteName = valueText(fields[2]) || remoteIp;
      candidates.set(`${remoteIp}:${remoteName}`, { protocol: 'MNDP', remoteName, remoteIp, remotePlatform: valueText(fields[4]), remotePort: valueText(fields[9]) });
    });
    socket.bind(0, () => { socket.setBroadcast(true); socket.send(Buffer.alloc(4), 0, 4, 5678, '255.255.255.255'); });
    socket.on('error', finish);
  });
}

async function discoverNeighbors(node, protocol) {
  const normalizedProtocol = ['cdp', 'lldp', 'mndp', 'all'].includes(protocol) ? protocol : 'all';
  const results = normalizedProtocol === 'mndp' ? await discoverMndpNeighbors() : await discoverSnmpNeighbors(node, normalizedProtocol === 'all' ? 'all' : normalizedProtocol).then(async (items) => normalizedProtocol === 'all' ? [...items, ...await discoverMndpNeighbors()] : items);
  const unique = new Map();
  results.forEach((candidate) => { const key = candidate.remoteIp || `${candidate.remoteName}:${candidate.remotePort || ''}`; if (!unique.has(key)) unique.set(key, candidate); });
  return [...unique.values()];
}

function pollLink(link) {
  const source = nodes.find((node) => node.id === link.sourceId);
  if (!source) return Promise.resolve({ ...link, status: 'offline', rx: 0, tx: 0 });
  return new Promise((resolve) => {
    const session = snmp.createSession(source.ip, source.community || process.env.SNMP_COMMUNITY || 'public', { port: Number(source.port || 161), timeout: Number(process.env.SNMP_TIMEOUT || 2000), retries: Number(process.env.SNMP_RETRIES || 1), version: snmp.Version2c });
    session.get([getInterfaceOid(link.interfaceIndex, 'rx'), getInterfaceOid(link.interfaceIndex, 'tx')], (error, varbinds) => {
      session.close();
      if (error || varbinds.some(snmp.isVarbindError)) return resolve({ ...link, status: 'offline', rx: 0, tx: 0 });
      const now = Date.now();
      const previous = snapshots.get(`link:${link.id}`);
      const elapsed = previous ? (now - previous.at) / 1000 : 0;
      const rxOctets = Number(varbinds[0].value); const txOctets = Number(varbinds[1].value);
      snapshots.set(`link:${link.id}`, { at: now, rxOctets, txOctets });
      resolve({ ...link, status: 'healthy', rx: elapsed ? +Math.max(0, (rxOctets - previous.rxOctets) * 8 / elapsed).toFixed(0) : 0, tx: elapsed ? +Math.max(0, (txOctets - previous.txOctets) * 8 / elapsed).toFixed(0) : 0 });
    });
  });
}

async function pollMikrotikHealth(node) {
  const [cpuEntries, descrEntries, sizeEntries, usedEntries] = await Promise.all([
    walkSnmp(node, MIKROTIK_CPU_OID), walkSnmp(node, MIKROTIK_STORAGE_DESCR_OID), walkSnmp(node, MIKROTIK_STORAGE_SIZE_OID), walkSnmp(node, MIKROTIK_STORAGE_USED_OID),
  ]);
  const cpuLoads = cpuEntries.map((item) => Number(item.value)).filter((value) => Number.isFinite(value));
  const cpu = cpuLoads.length ? Math.round(cpuLoads.reduce((sum, value) => sum + value, 0) / cpuLoads.length) : undefined;
  const memoryEntry = descrEntries.find((item) => /memory|ram/i.test(valueText(item.value)));
  let memory;
  if (memoryEntry) {
    const index = oidSuffix(memoryEntry.oid, MIKROTIK_STORAGE_DESCR_OID).join('.');
    const size = sizeEntries.find((item) => oidSuffix(item.oid, MIKROTIK_STORAGE_SIZE_OID).join('.') === index);
    const used = usedEntries.find((item) => oidSuffix(item.oid, MIKROTIK_STORAGE_USED_OID).join('.') === index);
    if (size && used && Number(size.value) > 0) memory = Math.min(100, Math.max(0, Math.round((Number(used.value) / Number(size.value)) * 100)));
  }
  return { cpu, memory };
}

function pollHealth(node) {
  if (node.platform === 'mikrotik') return pollMikrotikHealth(node).catch(() => ({}));
  return new Promise((resolve) => {
    const session = snmp.createSession(node.ip, node.community || process.env.SNMP_COMMUNITY || 'public', { port: Number(node.port || 161), timeout: Number(process.env.SNMP_TIMEOUT || 2000), retries: 0, version: snmp.Version2c });
    session.get(HEALTH_OIDS, (error, varbinds) => {
      session.close();
      if (error || varbinds.some(snmp.isVarbindError)) return resolve({});
      const [idle, totalMemory, availableMemory] = varbinds.map((varbind) => Number(varbind.value));
      resolve({ cpu: Math.min(100, Math.max(0, Math.round(100 - idle))), memory: totalMemory ? Math.min(100, Math.max(0, Math.round((1 - availableMemory / totalMemory) * 100))) : null });
    });
  });
}

function poll(node) {
  return new Promise((resolve) => {
    const session = snmp.createSession(node.ip, node.community || process.env.SNMP_COMMUNITY || 'public', {
      port: Number(node.port || process.env.SNMP_PORT || 161),
      timeout: Number(process.env.SNMP_TIMEOUT || 2000),
      retries: Number(process.env.SNMP_RETRIES || 1),
      version: snmp.Version2c,
    });
    const startedAt = Date.now();
    session.get(OIDS, (error, varbinds) => {
      session.close();
      if (error || varbinds.some(snmp.isVarbindError)) {
        const { community, ...publicNode } = node;
        resolve({ ...publicNode, status: 'offline', latency: null, rx: 0, tx: 0, error: error?.message || 'SNMP request failed' });
        return;
      }
      const [description, systemName, ticks, inOctets, outOctets] = varbinds.map((varbind) => varbind.value);
      const previous = snapshots.get(node.id);
      const now = Date.now();
      const elapsedSeconds = previous ? (now - previous.at) / 1000 : 0;
      const rx = elapsedSeconds ? Math.max(0, (Number(inOctets) - previous.inOctets) * 8 / elapsedSeconds / 1_000_000) : 0;
      const tx = elapsedSeconds ? Math.max(0, (Number(outOctets) - previous.outOctets) * 8 / elapsedSeconds / 1_000_000) : 0;
      snapshots.set(node.id, { at: now, inOctets: Number(inOctets), outOctets: Number(outOctets) });
      const { community, ...publicNode } = node;
      const systemDescription = String(description);
      pollHealth(node).then((health) => resolve({ ...publicNode, ...health, status: 'healthy', latency: Date.now() - startedAt, rx: +rx.toFixed(2), tx: +tx.toFixed(2), systemName: String(systemName), description: systemDescription, platformVersion: getPlatformVersion(systemDescription), uptime: formatUptime(Number(ticks)), uptimeTicks: Number(ticks) }));
    });
  });
}

async function getMetrics() {
  return Promise.all(nodes.map(poll));
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {});
  if (request.method === 'GET' && request.url === '/api/nodes') return send(response, 200, await getMetrics());
  if (request.method === 'GET' && request.url?.startsWith('/api/nodes/') && request.url.endsWith('/interfaces')) {
    const id = request.url.split('/')[3];
    const node = nodes.find((item) => item.id === id);
    return send(response, node ? 200 : 404, node ? await getInterfaces(node) : { error: 'Node not found.' });
  }
  if (request.method === 'POST' && request.url?.startsWith('/api/nodes/') && request.url.endsWith('/discover-neighbors')) {
    const id = request.url.split('/')[3];
    const node = nodes.find((item) => item.id === id);
    if (!node) return send(response, 404, { error: 'Node not found.' });
    let body = '';
    for await (const chunk of request) body += chunk;
    let protocol = 'all';
    try { protocol = JSON.parse(body || '{}').protocol || 'all'; } catch { return send(response, 400, { error: 'Invalid discovery request.' }); }
    try {
      return send(response, 200, { sourceId: node.id, protocol, candidates: await discoverNeighbors(node, protocol) });
    } catch (error) {
      return send(response, 502, { error: error.message || 'Neighbor discovery failed.' });
    }
  }
  if (request.method === 'GET' && request.url === '/api/links') return send(response, 200, await Promise.all(links.map(pollLink)));
  if (request.method === 'GET' && request.url === '/api/workspace') return send(response, 200, workspace);
  if (request.method === 'PUT' && request.url === '/api/workspace') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const { name } = JSON.parse(body || '{}');
    if (typeof name !== 'string' || !name.trim()) return send(response, 400, { error: 'A workspace name is required.' });
    workspace = { ...workspace, name: name.trim() };
    await saveWorkspace();
    return send(response, 200, workspace);
  }
  if (request.method === 'GET' && request.url === '/api/workspace/export') {
    return send(response, 200, { workspace, nodes, links });
  }
  if (request.method === 'POST' && request.url === '/api/workspace/import') {
    let body = '';
    for await (const chunk of request) body += chunk;
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      return send(response, 400, { error: 'Invalid workspace file.' });
    }
    const importedNodes = Array.isArray(payload.nodes) ? payload.nodes : null;
    const importedLinks = Array.isArray(payload.links) ? payload.links : null;
    const importedName = typeof payload.workspace?.name === 'string' ? payload.workspace.name.trim() : '';
    if (!importedNodes || !importedLinks || !importedName) return send(response, 400, { error: 'Workspace file must include a name, nodes, and links.' });
    if (!importedNodes.every((node) => node && typeof node.id === 'string' && typeof node.name === 'string' && typeof node.ip === 'string')) return send(response, 400, { error: 'Every node needs an id, name, and ip.' });
    nodes = importedNodes;
    links = importedLinks;
    workspace = { ...workspace, name: importedName };
    snapshots = new Map();
    await Promise.all([saveNodes(), saveLinks(), saveWorkspace()]);
    return send(response, 200, { workspace, nodes: await getMetrics(), links: await Promise.all(links.map(pollLink)) });
  }
  if (request.method === 'POST' && request.url?.startsWith('/api/nodes/') && request.url.endsWith('/ping')) {
    const id = request.url.split('/')[3];
    const node = nodes.find((item) => item.id === id);
    if (!node) return send(response, 404, { error: 'Node not found.' });
    try {
      const { stdout } = await execFileAsync('ping', ['-n', '1', '-w', '3000', node.ip], { timeout: 4000, windowsHide: true });
      const match = stdout.match(/time[=<](\d+)ms/i);
      return send(response, 200, { reachable: true, latency: match ? Number(match[1]) : null });
    } catch {
      return send(response, 200, { reachable: false, latency: null });
    }
  }
  if (request.method === 'POST' && request.url?.startsWith('/api/nodes/') && request.url.endsWith('/duplicate')) {
    const id = request.url.split('/')[3];
    const source = nodes.find((item) => item.id === id);
    if (!source) return send(response, 404, { error: 'Node not found.' });
    const copy = { ...source, id: `${source.id}-copy-${Date.now()}`, name: `${source.name} copy`, x: Math.min(94, (source.x || 50) + 4), y: Math.min(91, (source.y || 50) + 4) };
    nodes.push(copy);
    await saveNodes();
    const { community, ...publicNode } = copy;
    return send(response, 201, publicNode);
  }
  if (request.method === 'POST' && request.url === '/api/links') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const link = JSON.parse(body || '{}');
    if (!nodes.some((node) => node.id === link.sourceId) || !nodes.some((node) => node.id === link.targetId) || !Number.isInteger(Number(link.interfaceIndex)) || Number(link.interfaceIndex) < 1) return send(response, 400, { error: 'Valid source, target, and interface index are required.' });
    const savedLink = { id: `link-${Date.now()}`, sourceId: link.sourceId, targetId: link.targetId, interfaceIndex: Number(link.interfaceIndex), interfaceIp: link.interfaceIp || '' };
    links.push(savedLink);
    await saveLinks();
    return send(response, 201, savedLink);
  }
  if (request.method === 'PUT' && request.url?.startsWith('/api/links/')) {
    const id = request.url.split('/').pop();
    let body = '';
    for await (const chunk of request) body += chunk;
    const { sourceId, targetId, interfaceIndex, interfaceIp } = JSON.parse(body || '{}');
    const link = links.find((item) => item.id === id);
    if (!link || !nodes.some((node) => node.id === sourceId) || !nodes.some((node) => node.id === targetId) || !Number.isInteger(Number(interfaceIndex)) || Number(interfaceIndex) < 1) return send(response, 400, { error: 'Valid source, target, and interface index are required.' });
    Object.assign(link, { sourceId, targetId, interfaceIndex: Number(interfaceIndex), interfaceIp: interfaceIp || '' });
    snapshots.delete(`link:${id}`);
    await saveLinks();
    return send(response, 200, link);
  }
  if (request.method === 'POST' && request.url === '/api/nodes') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const node = JSON.parse(body || '{}');
    if (!node.id || !node.name || !node.type || !node.ip) return send(response, 400, { error: 'id, name, type, and ip are required.' });
    if (nodes.some((item) => item.id === node.id)) return send(response, 409, { error: 'Node already exists.' });
    nodes.push(node);
    await saveNodes();
    return send(response, 201, node);
  }
  if (request.method === 'PUT' && request.url?.startsWith('/api/nodes/')) {
    const id = request.url.split('/').pop();
    let body = '';
    for await (const chunk of request) body += chunk;
    const { name, ip, type, platform, port, community, x, y } = JSON.parse(body || '{}');
    let node = nodes.find((item) => item.id === id);
    const hasPosition = Number.isFinite(Number(x)) && Number.isFinite(Number(y));
    if (!node && (!name || !ip)) return send(response, 400, { error: 'A node name and non-empty IP address are required.' });
    if (!hasPosition && (typeof name !== 'string' || !name.trim() || typeof ip !== 'string' || !ip.trim())) return send(response, 400, { error: 'A node name and non-empty IP address are required.' });
    if (port !== undefined && (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)) return send(response, 400, { error: 'SNMP port must be between 1 and 65535.' });
    if (!node) {
      node = { id, name: name.trim(), type: type || 'device', ip: ip.trim(), port: Number(port || 161) };
      nodes.push(node);
    }
    if (name) node.name = name.trim();
    if (ip) node.ip = ip.trim();
    if (typeof type === 'string' && ['router', 'gateway', 'server', 'camera', 'device'].includes(type)) node.type = type;
    if (typeof platform === 'string' && ['mikrotik', 'openwrt', 'other'].includes(platform)) node.platform = platform;
    if (port !== undefined) node.port = Number(port);
    if (typeof community === 'string' && community.trim()) node.community = community.trim();
    if (hasPosition) {
      node.x = Math.min(94, Math.max(6, Number(x)));
      node.y = Math.min(91, Math.max(6, Number(y)));
    }
    snapshots.delete(id);
    await saveNodes();
    const { community: savedCommunity, ...publicNode } = node;
    return send(response, 200, publicNode);
  }
  if (request.method === 'DELETE' && request.url?.startsWith('/api/nodes/')) {
    const id = request.url.split('/').pop();
    const nodeIndex = nodes.findIndex((node) => node.id === id);
    if (nodeIndex === -1) return send(response, 404, { error: 'Node not found.' });
    nodes.splice(nodeIndex, 1);
    snapshots.delete(id);
    await saveNodes();
    return send(response, 204, {});
  }
  send(response, 404, { error: 'Not found' });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Another instance of the monitor may already be running.`);
  } else {
    console.error('SNMP monitor API failed to start:', error);
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, () => { console.log(`SNMP monitor API listening on http://127.0.0.1:${PORT}`); resolve(); });
});