const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('picturetool', {
  initial: () => ipcRenderer.invoke('initial'),
  folderList: path => ipcRenderer.invoke('folder-list', path),
  folderCover: path => ipcRenderer.invoke('folder-cover', path),
  setCover: (folder, file) => ipcRenderer.invoke('set-cover', folder, file),
  folder: path => ipcRenderer.invoke('folder', path),
  thumbnail: path => ipcRenderer.invoke('thumbnail', path),
  portals: paths => ipcRenderer.invoke('portals', paths),
  move: items => ipcRenderer.invoke('move', items),
  history: () => ipcRenderer.invoke('history'),
  duplicates: () => ipcRenderer.invoke('duplicates'),
  reveal: path => ipcRenderer.invoke('reveal', path),
  openImage: path => ipcRenderer.invoke('open-image', path),
  previewUrl: path => ipcRenderer.invoke('preview-url', path),
  previewData: path => ipcRenderer.invoke('preview-data', path)
});
