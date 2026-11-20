const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');

const ROOT = process.env.PICTURETOOL_ROOT || 'F:\\哏圖';
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.tif', '.tiff']);
const NAME_SORT = new Intl.Collator('zh-Hant-TW-u-co-zhuyin', { numeric: true, sensitivity: 'base' });
const allowedShortcutRoots = new Set();
let settingsPath;
let historyPath;
let thumbnailDir;

function inside(value) {
  const absolute = path.resolve(value);
  const relative = path.relative(path.resolve(ROOT), absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    if (![...allowedShortcutRoots].some(root => { const sub = path.relative(root, absolute); return !sub.startsWith('..') && !path.isAbsolute(sub); })) throw new Error('路径不在图片目录或快捷方式目标内');
  }
  return absolute;
}
function relative(value) { return path.relative(ROOT, value) || '.'; }
async function entries(dir) {
  const result = await fs.readdir(inside(dir), { withFileTypes: true });
  return result.filter(x => x.isDirectory() || (x.isFile() && (IMAGE_EXT.has(path.extname(x.name).toLowerCase()) || path.extname(x.name).toLowerCase() === '.lnk')));
}
async function shortcutFolder(file) {
  try {
    const raw = shell.readShortcutLink(file).target;
    if (!raw) return null;
    const target = path.resolve(raw);
    if (!(await fs.stat(target)).isDirectory()) return null;
    allowedShortcutRoots.add(target);
    return target;
  } catch { return null; }
}
async function loadSettings() {
  try { return JSON.parse(await fs.readFile(settingsPath, 'utf8')); }
  catch { return { portals: [] }; }
}
async function saveSettings(data) { await fs.writeFile(settingsPath, JSON.stringify(data, null, 2), 'utf8'); }
async function thumbnailData(file) {
  const stat = await fs.stat(file);
  const key = crypto.createHash('sha256').update(`${file}\0${stat.size}\0${stat.mtimeMs}`).digest('hex');
  const cached = path.join(thumbnailDir, `v4-${key}.png`);
  try { return `data:image/png;base64,${(await fs.readFile(cached)).toString('base64')}`; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const png = await sharp(file, { failOn: 'none', animated: false })
    .rotate().resize(480, 360, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
    .png({ compressionLevel: 6 }).toBuffer();
  await fs.mkdir(thumbnailDir, { recursive: true });
  await fs.writeFile(cached, png);
  return `data:image/png;base64,${png.toString('base64')}`;
}
async function hash(file) {
  const handle = await fs.open(file, 'r');
  const h = crypto.createHash('sha256');
  try { for await (const chunk of handle.createReadStream()) h.update(chunk); }
  finally { await handle.close().catch(() => {}); }
  return h.digest('hex');
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const dataDir = process.env.PICTURETOOL_DATA_DIR || app.getPath('userData');
  await fs.mkdir(dataDir, { recursive: true });
  settingsPath = path.join(dataDir, 'settings.json');
  historyPath = path.join(dataDir, 'history.jsonl');
  let workspace = path.dirname(app.getPath('exe'));
  for (let i = 0; i < 5; i++) {
    try { if (JSON.parse(await fs.readFile(path.join(workspace, 'package.json'), 'utf8')).name === 'picturetool') break; }
    catch { /* 继续向上查找工作区 */ }
    const parent = path.dirname(workspace);
    if (parent === workspace) { workspace = app.getPath('userData'); break; }
    workspace = parent;
  }
  thumbnailDir = path.join(workspace, '.picturetool', 'thumbs-v2');
  const win = new BrowserWindow({ width: 1500, height: 920, minWidth: 1050, minHeight: 650, backgroundColor: '#f5f3ee', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  ipcMain.handle('initial', async () => ({ root: ROOT, settings: await loadSettings() }));
  ipcMain.handle('folder-list', async (_, dir) => {
    const items = await entries(dir);
    const folders = items.filter(x => x.isDirectory()).sort((a, b) => NAME_SORT.compare(a.name, b.name));
    const settings = await loadSettings();
    const normal = await Promise.all(folders.map(async x => {
      const folder = path.join(dir, x.name);
      let cover = '';
      const coverPath = settings.covers?.[folder];
      if (coverPath && path.dirname(coverPath) === folder) {
        try { cover = await thumbnailData(coverPath); }
        catch { /* 原图已移走时显示普通文件夹图标 */ }
      }
      return { path: folder, name: x.name, cover };
    }));
    const shortcuts = await Promise.all(items.filter(x => x.isFile() && path.extname(x.name).toLowerCase() === '.lnk').map(async x => {
      const target = await shortcutFolder(path.join(dir, x.name));
      return target ? { path: target, name: x.name.slice(0, -4), cover: '', shortcut: true } : null;
    }));
    return [...normal, ...shortcuts.filter(Boolean)].sort((a, b) => NAME_SORT.compare(a.name, b.name));
  });
  ipcMain.handle('search-folders', async (_, query) => {
    const term = String(query || '').trim().toLowerCase();
    if (!term) return [];
    const found = [];
    async function visit(dir) { for (const entry of await entries(dir)) { const file = path.join(dir, entry.name); if (entry.isDirectory()) { if (entry.name.toLowerCase().includes(term)) found.push({ path: file, name: entry.name, cover: '' }); await visit(file); } else if (path.extname(entry.name).toLowerCase() === '.lnk' && entry.name.toLowerCase().includes(term)) { const target = await shortcutFolder(file); if (target) found.push({ path: target, name: entry.name.slice(0, -4), cover: '', shortcut: true }); } } }
    await visit(ROOT);
    return found.sort((a, b) => NAME_SORT.compare(a.name, b.name));
  });
  ipcMain.handle('folder-cover', async (_, folder) => {
    const target = inside(folder);
    const source = (await loadSettings()).covers?.[target];
    if (!source || path.dirname(source) !== target) return '';
    try { return await thumbnailData(source); }
    catch { return ''; }
  });
  ipcMain.handle('set-cover', async (_, folder, file) => {
    const target = inside(folder), source = inside(file);
    if (path.dirname(source) !== target) throw new Error('请选择当前文件夹中的一张图片');
    if (!IMAGE_EXT.has(path.extname(source).toLowerCase())) throw new Error('请选择图片文件');
    const metadata = await sharp(source).metadata();
    if (!metadata.width || !metadata.height) throw new Error('无法读取这张图片');
    const settings = await loadSettings();
    settings.covers = { ...settings.covers, [target]: source };
    await saveSettings(settings);
    return true;
  });
  ipcMain.handle('folder', async (_, dir) => {
    const items = await entries(dir);
    const images = await Promise.all(items.filter(x => x.isFile() && IMAGE_EXT.has(path.extname(x.name).toLowerCase())).map(async x => { const file = path.join(dir, x.name); return { path: file, name: x.name, modified: (await fs.stat(file)).mtimeMs }; }));
    return images.sort((a, b) => b.modified - a.modified || NAME_SORT.compare(a.name, b.name));
  });
  ipcMain.handle('thumbnail', async (_, file) => {
    inside(file);
    return thumbnailData(file);
  });
  ipcMain.handle('portals', async (_, portals) => {
    const unique = [...new Set(portals.map(inside))];
    for (const folder of unique) if (!(await fs.stat(folder)).isDirectory()) throw new Error('传送门目标不是文件夹');
    const settings = await loadSettings();
    settings.portals = unique;
    await saveSettings(settings); return unique;
  });
  ipcMain.handle('move', async (_, moves) => {
    if (!Array.isArray(moves) || !moves.length) return { moved: [] };
    const planned = [];
    for (const item of moves) {
      const source = inside(item.source), targetDir = inside(item.target);
      if (!(await fs.stat(source)).isFile() || !IMAGE_EXT.has(path.extname(source).toLowerCase())) throw new Error('来源不是图片文件');
      if (!(await fs.stat(targetDir)).isDirectory()) throw new Error('目标不是文件夹');
      const destination = path.join(targetDir, path.basename(source));
      if (source === destination) throw new Error('图片已在目标文件夹');
      try { await fs.access(destination); throw new Error(`目标已有同名图片：${path.basename(source)}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      planned.push({ source, destination, target: targetDir });
    }
    const destinations = planned.map(x => x.destination.toLowerCase());
    if (new Set(destinations).size !== destinations.length) throw new Error('待移动清单中有目标同名图片');
    const moved = [];
    async function clearMovedCovers() {
      if (!moved.length) return;
      const settings = await loadSettings();
      const sources = new Set(moved.map(x => x.source));
      for (const [folder, cover] of Object.entries(settings.covers || {})) if (sources.has(cover)) delete settings.covers[folder];
      await saveSettings(settings);
    }
    for (const item of planned) {
      try {
        try { await fs.rename(item.source, item.destination); }
        catch (error) {
          if (error.code !== 'EXDEV') throw error;
          await fs.copyFile(item.source, item.destination, require('node:fs').constants.COPYFILE_EXCL);
          await fs.unlink(item.source);
        }
        moved.push(item);
      }
      catch (error) {
        await clearMovedCovers();
        await fs.appendFile(historyPath, JSON.stringify({ time: new Date().toISOString(), type: 'move', items: moved.map(x => ({ from: relative(x.source), to: relative(x.destination) })), incomplete: true }) + '\n');
        throw new Error(`已移动 ${moved.length} 张，随后失败：${error.message}`);
      }
    }
    await clearMovedCovers();
    await fs.appendFile(historyPath, JSON.stringify({ time: new Date().toISOString(), type: 'move', items: moved.map(x => ({ from: relative(x.source), to: relative(x.destination) })) }) + '\n');
    return { moved: moved.map(x => ({ from: x.source, to: x.destination })) };
  });
  ipcMain.handle('history', async () => {
    try { return (await fs.readFile(historyPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).reverse(); }
    catch { return []; }
  });
  ipcMain.handle('duplicates', async () => {
    const files = [];
    async function visit(dir) { for (const entry of await entries(dir)) { const full = path.join(dir, entry.name); if (entry.isDirectory()) await visit(full); else files.push({ path: full, size: (await fs.stat(full)).size }); } }
    await visit(ROOT);
    const bySize = new Map();
    for (const file of files) bySize.set(file.size, [...(bySize.get(file.size) || []), file]);
    const byHash = new Map();
    for (const group of bySize.values()) if (group.length > 1) for (const file of group) { const key = await hash(file.path); byHash.set(key, [...(byHash.get(key) || []), file.path]); }
    return { scanned: files.length, groups: [...byHash.values()].filter(x => x.length > 1) };
  });
  ipcMain.handle('reveal', async (_, file) => { inside(file); shell.showItemInFolder(file); });
  ipcMain.handle('open-image', async (_, file) => { inside(file); const error = await shell.openPath(file); if (error) throw new Error(error); });
  ipcMain.handle('preview-url', async (_, file) => { inside(file); return pathToFileURL(file).href; });
  ipcMain.handle('preview-data', async (_, file) => { inside(file); const png = await sharp(file, { animated: false }).rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true }).png().toBuffer(); return `data:image/png;base64,${png.toString('base64')}`; });
  ipcMain.handle('choose-folder', async () => { const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  await win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
