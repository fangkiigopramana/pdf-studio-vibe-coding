
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// State
let pages = []; // { id, fileId, fileName, pdfDoc, pageIndex, rotation, canvas, thumbnail }
let files = []; // { id, name, size, arrayBuffer, pageCount }
let selectedPages = new Set();
let dragSrcIndex = null;
let pageIdCounter = 0;
let fileIdCounter = 0;

// ─── File Input ───────────────────────────────────────
document.getElementById('file-input').addEventListener('change', async (e) => {
  const filesToLoad = Array.from(e.target.files);
  e.target.value = '';
  for (const f of filesToLoad) await loadPDFFile(f);
});

// Drop Zone
['sidebar-drop'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('dragover'); });
  el.addEventListener('dragleave', () => el.classList.remove('dragover'));
  el.addEventListener('drop', async e => {
    e.preventDefault();
    el.classList.remove('dragover');
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    for (const f of droppedFiles) await loadPDFFile(f);
  });
});

// Main container drag over for files
document.getElementById('pages-container').addEventListener('dragover', e => {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault();
});
document.getElementById('pages-container').addEventListener('drop', async e => {
  if (!e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
  for (const f of droppedFiles) await loadPDFFile(f);
});

// ─── Load PDF ────────────────────────────────────────
async function loadPDFFile(file) {
  showLoading(`Memuat: ${file.name}`);
  try {
    const arrayBuffer = await file.arrayBuffer();
    const fileId = ++fileIdCounter;
    const pdfDocLib = await PDFLib.PDFDocument.load(arrayBuffer);
    const pageCount = pdfDocLib.getPageCount();

    files.push({ id: fileId, name: file.name, size: file.size, arrayBuffer, pageCount });

    // Render thumbnails using pdf.js
    const pdfDocJS = await pdfjsLib.getDocument({ data: arrayBuffer.slice() }).promise;

    for (let i = 0; i < pageCount; i++) {
      const pageId = ++pageIdCounter;
      pages.push({
        id: pageId,
        fileId,
        fileName: file.name,
        pdfDocLib,
        pdfDocJS,
        arrayBuffer,
        pageIndex: i,
        rotation: 0,
      });
    }

    await renderAllThumbnails();
    renderSidebar();
    renderGrid();
    updateStats();
    showToast(`✅ ${file.name} (${pageCount} halaman) berhasil dimuat`, 'success');
  } catch (err) {
    showToast(`❌ Gagal memuat ${file.name}`, 'error');
    console.error(err);
  } finally {
    hideLoading();
  }
}

// ─── Render Thumbnails ────────────────────────────────
async function renderAllThumbnails() {
  for (const pg of pages) {
    if (!pg.thumbnail) await renderThumbnail(pg);
  }
}

async function renderThumbnail(pg) {
  const pdfPage = await pg.pdfDocJS.getPage(pg.pageIndex + 1);
  const viewport = pdfPage.getViewport({ scale: 0.4, rotation: pg.rotation });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  pg.thumbnail = canvas.toDataURL();
}

// ─── Render Grid ─────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('pages-grid');
  const empty = document.getElementById('empty-state');
  const exportBtn = document.getElementById('export-btn');

  if (pages.length === 0) {
    grid.style.display = 'none';
    empty.style.display = '';
    exportBtn.disabled = true;
    return;
  }

  grid.style.display = '';
  empty.style.display = 'none';
  exportBtn.disabled = false;
  grid.innerHTML = '';

  pages.forEach((pg, idx) => {
    const card = document.createElement('div');
    card.className = 'page-card' + (selectedPages.has(pg.id) ? ' selected' : '');
    card.dataset.index = idx;
    card.dataset.rotation = pg.rotation;
    card.draggable = true;

    card.innerHTML = `
      <div class="page-actions">
        <button class="page-action-btn rotate" onclick="rotateSingle(${idx}, 90, event)" title="Rotate Kanan">↻</button>
        <button class="page-action-btn rotate" onclick="rotateSingle(${idx}, -90, event)" title="Rotate Kiri">↺</button>
        <button class="page-action-btn delete" onclick="deleteSingle(${idx}, event)" title="Hapus">✕</button>
      </div>
      <div class="page-canvas-wrap">
        ${pg.thumbnail ? `<img src="${pg.thumbnail}" style="width:100%;height:100%;object-fit:contain;display:block;">` : '<div style="background:#eee;width:100%;height:100%;"></div>'}
        ${pg.rotation !== 0 ? `<div class="rotate-indicator">${pg.rotation}°</div>` : ''}
      </div>
      <div class="page-number">Hal. ${idx + 1}</div>
      <div class="page-source">${truncate(pg.fileName, 22)}</div>
    `;

    // Click to select
    card.addEventListener('click', (e) => {
      if (e.target.closest('.page-action-btn')) return;
      toggleSelect(pg.id, e.shiftKey || e.ctrlKey || e.metaKey);
    });

    // Drag events
    card.addEventListener('dragstart', (e) => {
      dragSrcIndex = idx;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => card.classList.remove('dragging'));

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.page-card.drag-over').forEach(c => c.classList.remove('drag-over'));
      card.classList.add('drag-over');
    });

    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (dragSrcIndex === null || dragSrcIndex === idx) return;
      // Reorder
      const [moved] = pages.splice(dragSrcIndex, 1);
      pages.splice(idx, 0, moved);
      dragSrcIndex = null;
      renderGrid();
      updateStats();
      showToast('📄 Halaman berhasil dipindahkan', 'success');
    });

    grid.appendChild(card);
  });

  document.getElementById('page-count-label').textContent = `${pages.length} halaman`;
  updateSelectionBar();
}

// ─── Sidebar ──────────────────────────────────────────
function renderSidebar() {
  const el = document.getElementById('file-list');
  if (files.length === 0) { el.innerHTML = '<p style="color:var(--muted);font-size:12px;padding:8px;">Belum ada file</p>'; return; }

  el.innerHTML = files.map(f => `
    <div class="file-item ${pages.some(p => p.fileId === f.id) ? '' : 'inactive'}" style="margin-bottom:4px;">
      <div class="file-icon">PDF</div>
      <div class="file-info">
        <div class="file-name">${f.name}</div>
        <div class="file-meta">${f.pageCount} hal · ${formatSize(f.size)}</div>
      </div>
      <button class="file-remove" onclick="removeFile(${f.id})" title="Hapus file ini">×</button>
    </div>
  `).join('');
}

// ─── Selection ────────────────────────────────────────
function toggleSelect(id, multi) {
  if (multi) {
    if (selectedPages.has(id)) selectedPages.delete(id);
    else selectedPages.add(id);
  } else {
    if (selectedPages.has(id) && selectedPages.size === 1) selectedPages.clear();
    else { selectedPages.clear(); selectedPages.add(id); }
  }
  renderGrid();
  updateSelectionBar();
}

function selectAll() {
  pages.forEach(p => selectedPages.add(p.id));
  renderGrid();
  updateSelectionBar();
}

function deselectAll() {
  selectedPages.clear();
  renderGrid();
  updateSelectionBar();
}

function updateSelectionBar() {
  const bar = document.getElementById('selection-bar');
  const info = document.getElementById('selection-info');
  const count = selectedPages.size;
  if (count > 0) {
    bar.classList.add('active');
    info.textContent = `${count} halaman dipilih`;
  } else {
    bar.classList.remove('active');
  }
  document.getElementById('stat-selected').textContent = count;
}

// ─── Actions ──────────────────────────────────────────
function deleteSingle(idx, e) {
  e.stopPropagation();
  pages.splice(idx, 1);
  renderGrid();
  updateStats();
  showToast('🗑 Halaman dihapus', 'success');
}

function deleteSelected() {
  if (selectedPages.size === 0) { showToast('⚠ Pilih halaman dulu', 'error'); return; }
  pages = pages.filter(p => !selectedPages.has(p.id));
  selectedPages.clear();
  renderGrid();
  updateStats();
  showToast(`🗑 ${pages.length === 0 ? 'Semua' : selectedPages.size} halaman dihapus`, 'success');
}

async function rotateSingle(idx, deg, e) {
  e.stopPropagation();
  const pg = pages[idx];
  pg.rotation = (pg.rotation + deg + 360) % 360;
  pg.thumbnail = null;
  await renderThumbnail(pg);
  renderGrid();
}

async function rotateSelected(deg) {
  if (selectedPages.size === 0) { showToast('⚠ Pilih halaman dulu', 'error'); return; }
  showLoading('Merotasi halaman...');
  for (const pg of pages.filter(p => selectedPages.has(p.id))) {
    pg.rotation = (pg.rotation + deg + 360) % 360;
    pg.thumbnail = null;
    await renderThumbnail(pg);
  }
  hideLoading();
  renderGrid();
  showToast(`↻ ${selectedPages.size} halaman dirotasi`, 'success');
}

function removeFile(fileId) {
  files = files.filter(f => f.id !== fileId);
  pages = pages.filter(p => p.fileId !== fileId);
  selectedPages = new Set([...selectedPages].filter(id => pages.some(p => p.id === id)));
  renderSidebar();
  renderGrid();
  updateStats();
  showToast('📁 File dihapus', 'success');
}

function clearAll() {
  if (pages.length === 0 && files.length === 0) return;
  pages = []; files = []; selectedPages.clear();
  renderSidebar(); renderGrid(); updateStats();
  showToast('🗑 Semua file dibersihkan', 'success');
}

function triggerMerge() {
  if (files.length < 2) { showToast('⚠ Perlu minimal 2 file untuk digabungkan', 'error'); return; }
  showToast(`🔗 ${files.length} file siap digabungkan. Klik Export PDF untuk menyimpan.`, 'success');
}

// ─── Export PDF ───────────────────────────────────────
async function exportPDF() {
  if (pages.length === 0) return;
  showLoading('Membuat PDF...');
  try {
    const mergedPdf = await PDFLib.PDFDocument.create();

    for (const pg of pages) {
      const srcDoc = await PDFLib.PDFDocument.load(pg.arrayBuffer);
      const [copiedPage] = await mergedPdf.copyPages(srcDoc, [pg.pageIndex]);

      // Apply rotation
      if (pg.rotation !== 0) {
        const currentRot = copiedPage.getRotation().angle;
        copiedPage.setRotation(PDFLib.degrees((currentRot + pg.rotation) % 360));
      }

      mergedPdf.addPage(copiedPage);
    }

    const pdfBytes = await mergedPdf.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = files.length === 1 ? `edited_${files[0].name}` : `merged_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`✅ PDF berhasil diekspor (${pages.length} halaman)`, 'success');
  } catch (err) {
    showToast('❌ Gagal mengekspor PDF', 'error');
    console.error(err);
  } finally {
    hideLoading();
  }
}

// ─── Helpers ──────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-pages').textContent = pages.length;
  document.getElementById('stat-files').textContent = files.length;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

function showLoading(text = 'Memproses...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading').classList.add('active');
}

function hideLoading() {
  document.getElementById('loading').classList.remove('active');
}

function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Init
renderSidebar();
renderGrid();
updateStats();