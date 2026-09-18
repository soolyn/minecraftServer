const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', {
  state: () => ipcRenderer.invoke('state'),
  login: () => ipcRenderer.invoke('login'),
  logout: () => ipcRenderer.invoke('logout'),
  install: () => ipcRenderer.invoke('install'),
  play: () => ipcRenderer.invoke('play'),
  memory: value => ipcRenderer.invoke('memory', value),
  folder: () => ipcRenderer.invoke('folder'),
  releases: () => ipcRenderer.invoke('releases'),
  onState: callback => { ipcRenderer.on('state', (_, state) => callback(state)); }
});
