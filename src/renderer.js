const api = window.picturetool;
const $ = id => document.getElementById(id);
let root, current, images = [], folders = [], portals = [], selected = new Set(), queue = [];
let imageGeneration = 0, thumbnailJobs = [], activeThumbnails = 0;
const esc = value => String(value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const short = path => path === root ? '.' : path.slice(root.length + 1);
function toast(message) { const el = $('toast'); el.textContent = message; el.style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.style.display = 'none', 3500); }
function openModal(title, body, actions = []) { $('modal-title').textContent = title; $('modal-body').innerHTML = body; $('modal-actions').replaceChildren(...actions); $('modal').showModal(); }
function action(label, fn, primary = false) { const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary'; b.onclick = fn; return b; }
function closeModal() { $('modal').close(); }
function renderBreadcrumbs() {
  const parts = current === root ? [] : short(current).split(/[\\/]/);
  const paths = [root];
  for (const part of parts) paths.push(`${paths.at(-1)}\\${part}`);
  $('folder-breadcrumbs').innerHTML = paths.map((p, i) => `<button class="crumb ${i === paths.length - 1 ? 'current' : ''}" data-path="${esc(p)}">${esc(i ? parts[i - 1] : root.split(/[\\/]/).at(-1))}</button>`).join('<span class="crumb-separator">›</span>');
  $('folder-breadcrumbs').querySelectorAll('.crumb').forEach(button => button.onclick = () => { if (button.dataset.path !== current) showFolder(button.dataset.path); });
}
function renderFolders() {
  const query = $('tree-filter').value.trim().toLowerCase();
  const visible = folders.filter(x => x.name.toLowerCase().includes(query));
  $('tree').innerHTML = visible.length ? visible.map(x => `<div class="folder-card" draggable="true" data-folder="${esc(x.path)}"><div class="folder-cover">${x.cover ? `<img src="${x.cover}" alt="">` : '<span>▰</span>'}</div><div class="folder-card-name" title="${esc(x.name)}">${esc(x.name)}</div></div>`).join('') : '<div class="empty">这一层没有符合条件的文件夹</div>';
  $('tree').querySelectorAll('.folder-card').forEach(card => {
    card.onclick = () => showFolder(card.dataset.folder);
    card.ondragstart = event => { event.dataTransfer.setData('application/x-picturetool-folder', card.dataset.folder); event.dataTransfer.effectAllowed = 'copy'; };
  });
}
async function showFolder(folder) {
  current = folder; selected.clear(); $('filter').value = ''; $('tree-filter').value = '';
  $('folder-title').textContent = folder === root ? '全部图片' : folder.split(/[\\/]/).at(-1);
  $('folder-path').textContent = folder;
  $('images').innerHTML = '<div class="empty">正在读取图片…</div>';
  $('tree').innerHTML = '<div class="empty">正在读取文件夹…</div>';
  renderBreadcrumbs();
  const [imageResult, folderResult] = await Promise.allSettled([api.folder(folder), api.folderList(folder)]);
  if (current !== folder) return;
  if (imageResult.status === 'fulfilled') { images = imageResult.value; renderImages(); }
  else { images = []; $('images').innerHTML = `<div class="empty">无法读取图片：${esc(imageResult.reason.message)}</div>`; }
  if (folderResult.status === 'fulfilled') { folders = folderResult.value; renderFolders(); }
  else { folders = []; $('tree').innerHTML = `<div class="empty">无法读取文件夹：${esc(folderResult.reason.message)}</div>`; }
}
function pumpThumbnails() { while (activeThumbnails < 2 && thumbnailJobs.length) { const job = thumbnailJobs.shift(); if (job.generation !== imageGeneration || !job.card.isConnected) continue; activeThumbnails++; api.thumbnail(job.path).then(data => { if (data && job.generation === imageGeneration && job.card.isConnected) { const img = document.createElement('img'); img.src = data; img.alt = ''; job.card.querySelector('.thumb').replaceChildren(img); } }).catch(() => {}).finally(() => { activeThumbnails--; pumpThumbnails(); }); } }
function renderImages() {
  imageGeneration++; thumbnailJobs = [];
  const generation = imageGeneration;
  const q = $('filter').value.trim().toLowerCase();
  const matches = images.filter(x => x.name.toLowerCase().includes(q));
  const list = matches;
  $('image-count').textContent = `${images.length} 张`;
  $('selected-count').textContent = selected.size ? `已选择 ${selected.size} 张` : '未选择图片';
  $('set-cover').disabled = selected.size !== 1;
  $('images').innerHTML = list.length ? list.map(x => `<div class="image-card ${selected.has(x.path) ? 'selected' : ''}" draggable="true" data-image="${esc(x.path)}" title="${esc(x.name)}"><div class="thumb"><span>图片</span></div><div class="image-name">${esc(x.name)}</div></div>`).join('') : '<div class="empty">当前文件夹没有符合条件的图片</div>';
  const cards = [...$('images').querySelectorAll('.image-card')];
  function updateSelection() { $('selected-count').textContent = selected.size ? `已选择 ${selected.size} 张` : '未选择图片'; $('set-cover').disabled = selected.size !== 1; for (const card of cards) card.classList.toggle('selected', selected.has(card.dataset.image)); }
  for (const card of cards) {
    card.onclick = e => { const p = card.dataset.image; if (e.ctrlKey || e.metaKey) selected.has(p) ? selected.delete(p) : selected.add(p); else if (e.shiftKey) selected.add(p); else selected = new Set([p]); updateSelection(); };
    card.ondblclick = () => api.reveal(card.dataset.image);
    card.ondragstart = e => { const p = card.dataset.image; if (!selected.has(p)) { selected = new Set([p]); updateSelection(); } e.dataTransfer.setData('application/x-picturetool-images', JSON.stringify([...selected])); e.dataTransfer.effectAllowed = 'move'; };
  }
  const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); thumbnailJobs.push({ card: entry.target, path: entry.target.dataset.image, generation }); pumpThumbnails(); } }, { root: $('images'), rootMargin: '120px' });
  cards.forEach(x => observer.observe(x));
}
function renderPortals() {
  $('portals').innerHTML = portals.length ? portals.map(p => `<div class="portal" data-portal="${esc(p)}"><span class="portal-icon">▰</span><div class="portal-info"><div class="portal-name">${esc(p.split(/[\\/]/).at(-1))}</div><div class="portal-path" title="${esc(p)}">${esc(short(p))}</div></div><button title="移除传送门" data-remove="${esc(p)}">×</button></div>`).join('') : '<div class="portal-drop">把右侧的文件夹卡片<br>拖到这里建立传送门</div>';
  $('portals').querySelectorAll('.portal').forEach(el => {
    el.onclick = e => { if (!e.target.closest('button')) showFolder(el.dataset.portal); };
    el.ondragover = e => { e.preventDefault(); el.classList.add('drag-over'); };
    el.ondragleave = () => el.classList.remove('drag-over');
    el.ondrop = e => { e.preventDefault(); el.classList.remove('drag-over'); const files = e.dataTransfer.getData('application/x-picturetool-images'); if (files) addToQueue(JSON.parse(files), el.dataset.portal); };
    api.folderCover(el.dataset.portal).then(cover => { if (cover && el.isConnected) el.querySelector('.portal-icon').innerHTML = `<img src="${cover}" alt="">`; }).catch(() => {});
  });
  $('portals').querySelectorAll('[data-remove]').forEach(b => b.onclick = async e => { e.stopPropagation(); portals = await api.portals(portals.filter(x => x !== b.dataset.remove)); renderPortals(); });
}
function addToQueue(files, target) { let added = 0; for (const source of files) { if (source === `${target}\\${source.split(/[\\/]/).at(-1)}`) continue; if (!queue.some(x => x.source === source && x.target === target)) { queue.push({ source, target }); added++; } } updateQueue(); toast(added ? `已加入 ${added} 张图片，等待确认移动` : '这些图片已在待移动清单中'); }
function updateQueue() { $('queue-count').textContent = queue.length; }
function showQueue() { const groups = new Map(); queue.forEach((x, i) => groups.set(x.target, [...(groups.get(x.target) || []), { ...x, i }])); const body = queue.length ? [...groups].map(([target, list]) => `<div class="queue-group"><strong>移至 ${esc(short(target))} · ${list.length} 张</strong>${list.map(x => `<div class="queue-item"><span>${esc(short(x.source))}</span><button data-queue-remove="${x.i}">移除</button></div>`).join('')}</div>`).join('') : '<div class="empty">还没有待移动的图片。选中图片，拖到传送门即可加入。</div>'; openModal(`待移动 · ${queue.length} 张`, body, [action('关闭', closeModal), action(`确认移动 ${queue.length} 张`, async () => { try { const result = await api.move(queue); queue = []; updateQueue(); closeModal(); toast(`已移动 ${result.moved.length} 张图片`); await showFolder(current); renderPortals(); } catch(e) { toast(e.message); closeModal(); await showFolder(current); renderPortals(); } }, true)]); $('modal-actions').lastChild.disabled = !queue.length; $('modal-body').querySelectorAll('[data-queue-remove]').forEach(b => b.onclick = () => { queue.splice(Number(b.dataset.queueRemove), 1); updateQueue(); showQueue(); }); }
async function showHistory() { const rows = await api.history(); openModal('整理记录', rows.length ? rows.map(x => `<div class="history-item"><strong>${esc(new Date(x.time).toLocaleString('zh-CN'))} · 移动 ${x.items.length} 张${x.incomplete ? '（部分完成）' : ''}</strong><div>${x.items.map(i => `<div class="queue-item">${esc(i.from)} → ${esc(i.to)}</div>`).join('')}</div></div>`).join('') : '<div class="empty">还没有整理记录</div>', [action('关闭', closeModal)]); }
async function showDuplicates() { openModal('查找重复', '<div class="empty">正在对图片计算内容指纹，请稍候…</div>', [action('关闭', closeModal)]); try { const r = await api.duplicates(); $('modal-body').innerHTML = `<p style="margin-bottom:14px;color:#686e67">扫描 ${r.scanned} 张图片，发现 ${r.groups.length} 组内容完全相同的文件。</p>` + (r.groups.length ? r.groups.map((g, i) => `<div class="duplicate-group"><strong>第 ${i+1} 组 · ${g.length} 张</strong>${g.map(p => `<div class="queue-item">${esc(short(p))}</div>`).join('')}</div>`).join('') : '<div class="empty">没有发现内容完全相同的图片</div>'); } catch(e) { $('modal-body').textContent = e.message; } }
async function init() { try { const data = await api.initial(); root = data.root; portals = data.settings.portals || []; $('root-label').textContent = root; $('portals').ondragover = e => e.preventDefault(); $('portals').ondrop = async e => { if (e.target.closest('.portal')) return; e.preventDefault(); const folder = e.dataTransfer.getData('application/x-picturetool-folder'); if (folder && !portals.includes(folder)) { portals = await api.portals([...portals, folder]); renderPortals(); toast('已创建传送门'); } }; renderPortals(); await showFolder(root); } catch(e) { $('images').innerHTML = `<div class="empty">无法打开图片目录：${esc(e.message)}</div>`; } }
$('filter').oninput = renderImages; $('tree-filter').oninput = renderFolders; $('select-all').onclick = () => { selected = new Set(images.filter(x => x.name.toLowerCase().includes($('filter').value.trim().toLowerCase())).map(x => x.path)); renderImages(); }; $('set-cover').onclick = async () => { if (selected.size !== 1) return; try { await api.setCover(current, [...selected][0]); renderPortals(); toast('已设为这个文件夹的图标'); } catch (error) { toast(error.message); } }; $('queue-btn').onclick = showQueue; $('history-btn').onclick = showHistory; $('duplicates-btn').onclick = showDuplicates; $('modal-close').onclick = closeModal; init();
