const api = window.picturetool;
const $ = id => document.getElementById(id);
let root, tree, current, images = [], portals = [], selected = new Set(), queue = [], expanded = new Set();
let imageGeneration = 0, thumbnailJobs = [], activeThumbnails = 0;
const esc = value => String(value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const short = path => path === root ? '.' : path.slice(root.length + 1);
function toast(message) { const el = $('toast'); el.textContent = message; el.style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.style.display = 'none', 3500); }
function openModal(title, body, actions = []) { $('modal-title').textContent = title; $('modal-body').innerHTML = body; $('modal-actions').replaceChildren(...actions); $('modal').showModal(); }
function action(label, fn, primary = false) { const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary'; b.onclick = fn; return b; }
function closeModal() { $('modal').close(); }
function nodeHtml(node, query = '') {
  const matches = !query || node.name.toLowerCase().includes(query) || node.children.some(child => hasMatch(child, query));
  if (!matches) return '';
  const open = query || expanded.has(node.path);
  return `<div class="tree-node"><div class="tree-row ${node.path === current ? 'active' : ''}" draggable="true" data-folder="${esc(node.path)}"><span class="tree-toggle">${node.children.length || !node.loaded ? (open ? '▾' : '▸') : ''}</span><span class="tree-icon">▰</span><span class="tree-name" title="${esc(node.path)}">${esc(node.name)}</span></div>${open ? `<div class="tree-children">${node.children.map(x => nodeHtml(x, query)).join('')}</div>` : ''}</div>`;
}
function hasMatch(node, q) { return node.name.toLowerCase().includes(q) || node.children.some(x => hasMatch(x, q)); }
function findNode(node, folder) { if (node.path === folder) return node; for (const child of node.children) { const found = findNode(child, folder); if (found) return found; } return null; }
async function loadFullTree() {
  $('tree-filter').placeholder = '正在读取完整目录树…';
  try {
    const complete = await api.fullTree();
    const scroll = $('tree').scrollTop;
    tree = complete;
    function expand(node) { expanded.add(node.path); node.children.forEach(expand); }
    expand(tree);
    renderTree();
    $('tree').scrollTop = scroll;
  } catch (error) { toast(`目录树读取失败：${error.message}`); }
  finally { $('tree-filter').placeholder = '查找所有文件夹'; }
}
function renderTree() { $('tree').innerHTML = nodeHtml(tree, $('tree-filter').value.trim().toLowerCase()); $('tree').querySelectorAll('.tree-row').forEach(row => { row.onclick = async e => { const folder = row.dataset.folder; if (e.target.classList.contains('tree-toggle')) { const node = findNode(tree, folder); if (expanded.has(folder)) expanded.delete(folder); else { expanded.add(folder); if (!node.loaded) { try { node.children = await api.folderChildren(folder); node.loaded = true; } catch (error) { toast(error.message); } } } renderTree(); } else showFolder(folder); }; row.ondragstart = e => { e.dataTransfer.setData('application/x-picturetool-folder', row.dataset.folder); e.dataTransfer.effectAllowed = 'copy'; }; }); }
async function showFolder(folder) { current = folder; selected.clear(); $('filter').value = ''; $('folder-title').textContent = folder === root ? '全部图片' : folder.split(/[\\/]/).at(-1); $('folder-path').textContent = folder; $('images').innerHTML = '<div class="empty">正在读取图片…</div>'; renderTree(); try { const result = await api.folder(folder); if (current !== folder) return; images = result; renderImages(); } catch (e) { toast(e.message); } }
function pumpThumbnails() { while (activeThumbnails < 2 && thumbnailJobs.length) { const job = thumbnailJobs.shift(); if (job.generation !== imageGeneration || !job.card.isConnected) continue; activeThumbnails++; api.thumbnail(job.path).then(data => { if (data && job.generation === imageGeneration && job.card.isConnected) { const img = document.createElement('img'); img.src = data; img.alt = ''; job.card.querySelector('.thumb').replaceChildren(img); } }).catch(() => {}).finally(() => { activeThumbnails--; pumpThumbnails(); }); } }
function renderImages() {
  imageGeneration++; thumbnailJobs = [];
  const generation = imageGeneration;
  const q = $('filter').value.trim().toLowerCase();
  const matches = images.filter(x => x.name.toLowerCase().includes(q));
  const list = matches;
  $('image-count').textContent = `${images.length} 张`;
  $('selected-count').textContent = selected.size ? `已选择 ${selected.size} 张` : '未选择图片';
  $('images').innerHTML = list.length ? list.map(x => `<div class="image-card ${selected.has(x.path) ? 'selected' : ''}" draggable="true" data-image="${esc(x.path)}" title="${esc(x.name)}"><div class="thumb"><span>图片</span></div><div class="image-name">${esc(x.name)}</div></div>`).join('') : '<div class="empty">当前文件夹没有符合条件的图片</div>';
  const cards = [...$('images').querySelectorAll('.image-card')];
  function updateSelection() { $('selected-count').textContent = selected.size ? `已选择 ${selected.size} 张` : '未选择图片'; for (const card of cards) card.classList.toggle('selected', selected.has(card.dataset.image)); }
  for (const card of cards) {
    card.onclick = e => { const p = card.dataset.image; if (e.ctrlKey || e.metaKey) selected.has(p) ? selected.delete(p) : selected.add(p); else if (e.shiftKey) selected.add(p); else selected = new Set([p]); updateSelection(); };
    card.ondblclick = () => api.reveal(card.dataset.image);
    card.ondragstart = e => { const p = card.dataset.image; if (!selected.has(p)) { selected = new Set([p]); updateSelection(); } e.dataTransfer.setData('application/x-picturetool-images', JSON.stringify([...selected])); e.dataTransfer.effectAllowed = 'move'; };
  }
  const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); thumbnailJobs.push({ card: entry.target, path: entry.target.dataset.image, generation }); pumpThumbnails(); } }, { root: $('images'), rootMargin: '120px' });
  cards.forEach(x => observer.observe(x));
}
function renderPortals() { $('portals').innerHTML = portals.length ? portals.map(p => `<div class="portal" data-portal="${esc(p)}"><span class="portal-icon">▰</span><div class="portal-info"><div class="portal-name">${esc(p.split(/[\\/]/).at(-1))}</div><div class="portal-path" title="${esc(p)}">${esc(short(p))}</div></div><button title="移除传送门" data-remove="${esc(p)}">×</button></div>`).join('') : '<div class="portal-drop">把目录树中的文件夹<br>拖到这里建立传送门</div>'; $('portals').querySelectorAll('.portal').forEach(el => { el.onclick = e => { if (!e.target.closest('button')) showFolder(el.dataset.portal); }; el.ondragover = e => { e.preventDefault(); el.classList.add('drag-over'); }; el.ondragleave = () => el.classList.remove('drag-over'); el.ondrop = e => { e.preventDefault(); el.classList.remove('drag-over'); const files = e.dataTransfer.getData('application/x-picturetool-images'); if (files) addToQueue(JSON.parse(files), el.dataset.portal); }; }); $('portals').querySelectorAll('[data-remove]').forEach(b => b.onclick = async e => { e.stopPropagation(); portals = await api.portals(portals.filter(x => x !== b.dataset.remove)); renderPortals(); }); }
function addToQueue(files, target) { let added = 0; for (const source of files) { if (source === `${target}\\${source.split(/[\\/]/).at(-1)}`) continue; if (!queue.some(x => x.source === source && x.target === target)) { queue.push({ source, target }); added++; } } updateQueue(); toast(added ? `已加入 ${added} 张图片，等待确认移动` : '这些图片已在待移动清单中'); }
function updateQueue() { $('queue-count').textContent = queue.length; }
function showQueue() { const groups = new Map(); queue.forEach((x, i) => groups.set(x.target, [...(groups.get(x.target) || []), { ...x, i }])); const body = queue.length ? [...groups].map(([target, list]) => `<div class="queue-group"><strong>移至 ${esc(short(target))} · ${list.length} 张</strong>${list.map(x => `<div class="queue-item"><span>${esc(short(x.source))}</span><button data-queue-remove="${x.i}">移除</button></div>`).join('')}</div>`).join('') : '<div class="empty">还没有待移动的图片。选中图片，拖到传送门即可加入。</div>'; openModal(`待移动 · ${queue.length} 张`, body, [action('关闭', closeModal), action(`确认移动 ${queue.length} 张`, async () => { try { const result = await api.move(queue); queue = []; updateQueue(); closeModal(); toast(`已移动 ${result.moved.length} 张图片`); await showFolder(current); } catch(e) { toast(e.message); closeModal(); await showFolder(current); } }, true)]); $('modal-actions').lastChild.disabled = !queue.length; $('modal-body').querySelectorAll('[data-queue-remove]').forEach(b => b.onclick = () => { queue.splice(Number(b.dataset.queueRemove), 1); updateQueue(); showQueue(); }); }
async function showHistory() { const rows = await api.history(); openModal('整理记录', rows.length ? rows.map(x => `<div class="history-item"><strong>${esc(new Date(x.time).toLocaleString('zh-CN'))} · 移动 ${x.items.length} 张${x.incomplete ? '（部分完成）' : ''}</strong><div>${x.items.map(i => `<div class="queue-item">${esc(i.from)} → ${esc(i.to)}</div>`).join('')}</div></div>`).join('') : '<div class="empty">还没有整理记录</div>', [action('关闭', closeModal)]); }
async function showDuplicates() { openModal('查找重复', '<div class="empty">正在对图片计算内容指纹，请稍候…</div>', [action('关闭', closeModal)]); try { const r = await api.duplicates(); $('modal-body').innerHTML = `<p style="margin-bottom:14px;color:#686e67">扫描 ${r.scanned} 张图片，发现 ${r.groups.length} 组内容完全相同的文件。</p>` + (r.groups.length ? r.groups.map((g, i) => `<div class="duplicate-group"><strong>第 ${i+1} 组 · ${g.length} 张</strong>${g.map(p => `<div class="queue-item">${esc(short(p))}</div>`).join('')}</div>`).join('') : '<div class="empty">没有发现内容完全相同的图片</div>'); } catch(e) { $('modal-body').textContent = e.message; } }
async function init() { try { const data = await api.initial(); root = data.root; tree = data.tree; portals = data.settings.portals || []; expanded.add(root); $('root-label').textContent = root; $('portals').ondragover = e => e.preventDefault(); $('portals').ondrop = async e => { if (e.target.closest('.portal')) return; e.preventDefault(); const folder = e.dataTransfer.getData('application/x-picturetool-folder'); if (folder && !portals.includes(folder)) { portals = await api.portals([...portals, folder]); renderPortals(); toast('已创建传送门'); } }; renderPortals(); await showFolder(root); void loadFullTree(); } catch(e) { $('images').innerHTML = `<div class="empty">无法打开图片目录：${esc(e.message)}</div>`; } }
$('filter').oninput = renderImages; $('tree-filter').oninput = renderTree; $('select-all').onclick = () => { selected = new Set(images.filter(x => x.name.toLowerCase().includes($('filter').value.trim().toLowerCase())).map(x => x.path)); renderImages(); }; $('queue-btn').onclick = showQueue; $('history-btn').onclick = showHistory; $('duplicates-btn').onclick = showDuplicates; $('modal-close').onclick = closeModal; init();
