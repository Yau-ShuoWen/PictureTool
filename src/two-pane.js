const api = window.picturetool;
const $ = id => document.getElementById(id);
const panes = [0, 1].map((id) => ({ id, folder: '', images: [], folders: [], selected: new Set(), anchor: -1, filter: '', generation: 0 }));
let root = '', queue = [], preview = [], previewIndex = -1, contextFile = '', scale = 1, offsetX = 0, offsetY = 0, dragOrigin = null;
const esc = value => String(value).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
function nameOf(path) { return path.split(/[\\/]/).at(-1); }
function toast(message) { const box = $('toast'); box.textContent = message; box.style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => box.style.display = 'none', 3000); }
function panel(p) { return $(p.id ? 'right-pane' : 'left-pane'); }
function drawShell(p) {
  panel(p).innerHTML = `<div class="pane-head"><div><small>${p.id ? '右侧' : '左侧'}</small><h2 class="pane-title"></h2></div><span class="pane-count"></span></div><div class="pane-path"></div><div class="pane-actions"><input class="pane-filter" placeholder="筛选当前文件夹" aria-label="筛选当前文件夹"><button class="pane-select-all">全选</button><button class="pane-cover" disabled>设为图标</button></div><div class="pane-content"><div class="pane-items"></div></div>`;
  const el = panel(p);
  el.querySelector('.pane-filter').oninput = e => { p.filter = e.target.value.toLowerCase(); drawItems(p); };
  el.querySelector('.pane-select-all').onclick = () => { p.selected = new Set(p.images.filter(x => x.name.toLowerCase().includes(p.filter)).map(x => x.path)); updateSelected(p); };
  el.querySelector('.pane-cover').onclick = async () => { if (p.selected.size !== 1) return; try { await api.setCover(p.folder, [...p.selected][0]); toast('文件夹图标已设置'); await Promise.all(panes.map(x => loadPane(x, x.folder))); } catch (e) { toast(e.message); } };
  const content = el.querySelector('.pane-content');
  content.ondragover = e => { if (e.dataTransfer.types.includes('application/x-picturetool-images')) { e.preventDefault(); content.classList.add('drop-target'); } };
  content.ondragleave = e => { if (!content.contains(e.relatedTarget)) content.classList.remove('drop-target'); };
  content.ondrop = e => { e.preventDefault(); content.classList.remove('drop-target'); const raw = e.dataTransfer.getData('application/x-picturetool-images'); if (raw) addQueue(JSON.parse(raw), p.folder); };
  content.onpointerdown = e => startMarquee(e, p);
}
async function loadPane(p, folder) {
  p.folder = folder; p.selected.clear(); p.filter = ''; p.generation++;
  const el = panel(p); el.querySelector('.pane-title').textContent = nameOf(folder); el.querySelector('.pane-filter').value = '';
  const parts = folder === root ? [] : folder.slice(root.length + 1).split(/[\\/]/);
  const paths = [root]; for (const part of parts) paths.push(`${paths.at(-1)}\\${part}`);
  el.querySelector('.pane-path').innerHTML = paths.map((x, i) => `<button data-path="${esc(x)}">${esc(i ? parts[i - 1] : nameOf(root))}</button>`).join(' › ');
  el.querySelectorAll('.pane-path button').forEach(b => b.onclick = () => loadPane(p, b.dataset.path));
  const [images, folders] = await Promise.all([api.folder(folder), api.folderList(folder)]);
  if (p.folder !== folder) return;
  p.images = images; p.folders = folders; drawItems(p);
}
function drawItems(p) {
  const el = panel(p), content = el.querySelector('.pane-content');
  el.querySelector('.pane-count').textContent = `${p.folders.length} 文件夹 · ${p.images.length} 图片`;
  const folders = p.folders.filter(x => x.name.toLowerCase().includes(p.filter));
  const folderHtml = folders.map(x => `<div class="folder-card" data-folder="${esc(x.path)}"><div class="folder-cover">${x.cover ? `<img src="${x.cover}" alt="">` : '<span>▰</span>'}</div><div class="folder-card-name">${esc(x.name)}</div></div>`).join('');
  const images = p.images.filter(x => x.name.toLowerCase().includes(p.filter));
  const imageHtml = images.map(x => `<div class="image-card ${p.selected.has(x.path) ? 'selected' : ''}" draggable="true" data-image="${esc(x.path)}" title="${esc(x.name)}"><div class="thumb">图片</div></div>`).join('');
  el.querySelector('.pane-items').innerHTML = folderHtml + imageHtml;
  el.querySelectorAll('.folder-card').forEach(card => { card.ondblclick = () => loadPane(p, card.dataset.folder); card.onclick = () => card.classList.toggle('selected'); card.ondragover = e => { e.preventDefault(); }; card.ondrop = e => { e.preventDefault(); e.stopPropagation(); const raw = e.dataTransfer.getData('application/x-picturetool-images'); if (raw) addQueue(JSON.parse(raw), card.dataset.folder); }; });
  const cards = [...el.querySelectorAll('.pane-items .image-card')];
  cards.forEach((card, index) => {
    card.onclick = e => { const file = card.dataset.image; if (e.shiftKey && p.anchor >= 0) { if (!e.ctrlKey) p.selected.clear(); for (let i = Math.min(index, p.anchor); i <= Math.max(index, p.anchor); i++) p.selected.add(images[i].path); } else if (e.ctrlKey) { p.selected.has(file) ? p.selected.delete(file) : p.selected.add(file); p.anchor = index; } else { p.selected = new Set([file]); p.anchor = index; } updateSelected(p); };
    card.ondblclick = () => { preview = images; previewIndex = index; showPreview(); };
    card.ondragstart = e => { if (!p.selected.has(card.dataset.image)) p.selected = new Set([card.dataset.image]); updateSelected(p); e.dataTransfer.setData('application/x-picturetool-images', JSON.stringify([...p.selected])); e.dataTransfer.effectAllowed = 'move'; };
    card.oncontextmenu = e => { e.preventDefault(); contextFile = card.dataset.image; const menu = $('image-context-menu'); menu.hidden = false; menu.style.left = `${Math.min(e.clientX, innerWidth - 190)}px`; menu.style.top = `${Math.min(e.clientY, innerHeight - 90)}px`; };
  });
  updateSelected(p);
  const generation = ++p.generation, jobs = []; let active = 0;
  function pump() { while (active < 2 && jobs.length) { const card = jobs.shift(); if (generation !== p.generation || !card.isConnected) continue; active++; api.thumbnail(card.dataset.image).then(data => { if (data && generation === p.generation && card.isConnected) { const img = new Image(); img.src = data; card.querySelector('.thumb').replaceChildren(img); } }).catch(() => {}).finally(() => { active--; pump(); }); } }
  const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); jobs.push(entry.target); pump(); } }, { root: content, rootMargin: '100px' }); cards.forEach(x => observer.observe(x));
}
function updateSelected(p) { const el = panel(p); el.querySelector('.pane-cover').disabled = p.selected.size !== 1; el.querySelectorAll('.pane-items .image-card').forEach(card => card.classList.toggle('selected', p.selected.has(card.dataset.image))); }
function startMarquee(e, p) {
  if (e.button !== 0 || e.target.closest('.image-card,.folder-card,button,input')) return;
  const content = panel(p).querySelector('.pane-content'), origin = { x: e.clientX, y: e.clientY }, initial = e.ctrlKey ? new Set(p.selected) : new Set();
  if (!e.ctrlKey) { p.selected.clear(); updateSelected(p); }
  const box = document.createElement('div'); box.className = 'selection-box'; document.body.append(box);
  content.setPointerCapture(e.pointerId);
  const move = event => { const l = Math.min(origin.x, event.clientX), t = Math.min(origin.y, event.clientY), r = Math.max(origin.x, event.clientX), b = Math.max(origin.y, event.clientY); Object.assign(box.style, { left: `${l}px`, top: `${t}px`, width: `${r-l}px`, height: `${b-t}px` }); p.selected = new Set(initial); panel(p).querySelectorAll('.pane-items .image-card').forEach(card => { const q = card.getBoundingClientRect(); if (q.left < r && q.right > l && q.top < b && q.bottom > t) p.selected.add(card.dataset.image); }); updateSelected(p); };
  const end = () => { content.removeEventListener('pointermove', move); content.removeEventListener('pointerup', end); content.removeEventListener('pointercancel', end); box.remove(); };
  content.addEventListener('pointermove', move); content.addEventListener('pointerup', end); content.addEventListener('pointercancel', end);
}
function addQueue(files, target) { const added = files.filter(source => !queue.some(x => x.source === source && x.target === target) && source !== `${target}\\${nameOf(source)}`); queue.push(...added.map(source => ({ source, target }))); $('queue-count').textContent = queue.length; toast(`待移动 ${queue.length} 张`); }
function showQueue() { const body = queue.map(x => `<div class="queue-item">${esc(nameOf(x.source))} → ${esc(x.target.slice(root.length + 1))}</div>`).join('') || '没有待移动的图片'; openModal(`待移动 ${queue.length} 张`, body, [button('关闭', () => $('modal').close()), button(`确认移动 ${queue.length} 张`, async () => { try { await api.move(queue); queue = []; $('queue-count').textContent = '0'; $('modal').close(); await Promise.all(panes.map(p => loadPane(p, p.folder))); toast('移动完成'); } catch (e) { toast(e.message); } })]); }
function button(label, fn) { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; return b; }
function openModal(title, body, actions) { $('modal-title').textContent = title; $('modal-body').innerHTML = body; $('modal-actions').replaceChildren(...actions); $('modal').showModal(); }
async function showPreview() { const file = preview[previewIndex]?.path; if (!file) return; $('preview-name').textContent = nameOf(file); scale = 1; offsetX = 0; offsetY = 0; position(); const img = $('preview-image'); img.dataset.file = file; img.dataset.fallback = ''; img.src = await api.previewUrl(file); $('preview-prev').disabled = previewIndex === 0; $('preview-next').disabled = previewIndex === preview.length - 1; if (!$('preview-dialog').open) $('preview-dialog').showModal(); }
function position() { $('preview-image').style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`; }
async function init() { const data = await api.initial(); root = data.root; $('root-label').textContent = root; panes.forEach(drawShell); await Promise.all(panes.map(p => loadPane(p, root))); }
$('queue-btn').onclick = showQueue; $('modal-close').onclick = () => $('modal').close();
$('history-btn').onclick = async () => { const rows = await api.history(); openModal('整理记录', rows.map(x => `<div class="history-item">${esc(new Date(x.time).toLocaleString())} · ${x.items.length} 张</div>`).join('') || '暂无记录', [button('关闭', () => $('modal').close())]); };
$('duplicates-btn').onclick = async () => { openModal('查找重复', '正在检查…', [button('关闭', () => $('modal').close())]); const result = await api.duplicates(); $('modal-body').textContent = `扫描 ${result.scanned} 张，发现 ${result.groups.length} 组完全相同图片`; };
$('preview-close').onclick = () => $('preview-dialog').close(); $('preview-prev').onclick = () => { previewIndex--; showPreview(); }; $('preview-next').onclick = () => { previewIndex++; showPreview(); };
$('preview-image').onerror = async () => { const img = $('preview-image'); if (img.dataset.fallback) return; img.dataset.fallback = '1'; try { img.src = await api.previewData(img.dataset.file); } catch { toast('无法预览图片'); } };
$('preview-canvas').onwheel = e => { e.preventDefault(); scale = Math.max(.2, Math.min(8, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); position(); };
$('preview-canvas').onpointerdown = e => { dragOrigin = { x: e.clientX - offsetX, y: e.clientY - offsetY }; $('preview-canvas').setPointerCapture(e.pointerId); };
$('preview-canvas').onpointermove = e => { if (dragOrigin) { offsetX = e.clientX - dragOrigin.x; offsetY = e.clientY - dragOrigin.y; position(); } };
$('preview-canvas').onpointerup = () => { dragOrigin = null; };
$('preview-canvas').onclick = e => { const q = $('preview-image').getBoundingClientRect(); if (e.clientX < q.left || e.clientX > q.right || e.clientY < q.top || e.clientY > q.bottom) $('preview-dialog').close(); };
$('preview-dialog').onkeydown = e => { if (e.key === 'ArrowLeft') $('preview-prev').click(); if (e.key === 'ArrowRight') $('preview-next').click(); };
$('context-reveal').onclick = () => { $('image-context-menu').hidden = true; api.reveal(contextFile); }; $('context-open').onclick = () => { $('image-context-menu').hidden = true; api.openImage(contextFile); };
document.addEventListener('click', e => { if (!e.target.closest('#image-context-menu')) $('image-context-menu').hidden = true; });
init().catch(e => toast(e.message));
