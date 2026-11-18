const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('picturetool', {
  initial: () => ipcRenderer.invoke('initial'),
  folderChildren: path => ipcRenderer.invoke('folder-children', path),
  folder: path => ipcRenderer.invoke('folder', path),
  thumbnail: path => ipcRenderer.invoke('thumbnail', path),
  portals: paths => ipcRenderer.invoke('portals', paths),
  move: items => ipcRenderer.invoke('move', items),
  history: () => ipcRenderer.invoke('history'),
  duplicates: () => ipcRenderer.invoke('duplicates'),
  reveal: path => ipcRenderer.invoke('reveal', path)
});
