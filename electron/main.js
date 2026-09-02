import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const iconPath = path.join(rootDir, 'build', 'icon.png');
const HOMEPAGE = 'https://wna.gr/netatlas';
const COPYRIGHT = 'Copyright \u00A9 2026 Leonidas Papadopoulos';

let mainWindow;
let backendStarted = false;

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About Network Atlas',
    message: 'Network Atlas',
    detail: `Version ${app.getVersion()}\n${COPYRIGHT}\n${HOMEPAGE}`,
    buttons: ['OK'],
  });
}

function buildMenu() {
  app.setAboutPanelOptions({
    applicationName: 'Network Atlas',
    applicationVersion: app.getVersion(),
    copyright: COPYRIGHT,
    website: HOMEPAGE,
  });

  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [{ label: 'About Network Atlas', click: showAboutDialog }, { type: 'separator' }, { role: 'quit' }],
    }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Visit netatlas.wna.gr', click: () => shell.openExternal(HOMEPAGE) },
        { type: 'separator' },
        { label: 'About Network Atlas', click: showAboutDialog },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function startBackend() {
  if (backendStarted) return;
  backendStarted = true;

  const serverPath = path.join(rootDir, 'server.js');

  try {
    await import(pathToFileURL(serverPath).href);
  } catch (error) {
    console.error('Failed to start the SNMP backend inside Electron:', error);
    app.quit();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1200,
    minHeight: 780,
    title: 'Network Atlas',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  const indexPath = path.join(rootDir, 'dist', 'index.html');

  if (fs.existsSync(indexPath)) {
    mainWindow.loadFile(indexPath);
    return;
  }

  mainWindow.loadURL('http://127.0.0.1:5173');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  buildMenu();
  await startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
