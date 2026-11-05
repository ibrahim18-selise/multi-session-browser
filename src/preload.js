'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set(['state', 'ui', 'toast', 'pw-offer', 'pw-available']);

contextBridge.exposeInMainWorld('msb', {
  cmd: (name, ...args) => ipcRenderer.invoke('cmd', name, ...args),
  on: (channel, fn) => {
    if (!CHANNELS.has(channel)) return () => {};
    const handler = (_event, ...args) => fn(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  platform: process.platform
});
