(() => {
  'use strict';

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  // photos: [{ id, name, thumbUrl, status, error }]
  // entries: [{ id, photoId, photoName, value, length, duplicate }]
  const state = {
    photos: [],
    entries: [],
    lineCounter: 0,
  };

  let worker = null;
  let workerReady = null;

  // ---------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const queueEl = document.getElementById('queue');
  const lengthOverride = document.getElementById('lengthOverride');
  const lengthDetected = document.getElementById('lengthDetected');
  const manifestEmpty = document.getElementById('manifestEmpty');
  const manifestTable = document.getElementById('manifestTable');
  const manifestBody = document.getElementById('manifestBody');
  const statPhotos = document.getElementById('statPhotos');
  const statNumbers = document.getElementById('statNumbers');
  const btnCopyAll = document.getElementById('btnCopyAll');
  const btnExportCsv = document.getElementById('btnExportCsv');
  const btnClear = document.getElementById('btnClear');
  const toastEl = document.getElementById('toast');
  const engineStatus = document.getElementById('engineStatus');

  // ---------------------------------------------------------------
  // OCR worker
  // ---------------------------------------------------------------
  function ensureWorker() {
    if (workerReady) return workerReady;
    workerReady = (async () => {
      if (typeof Tesseract === 'undefined') {
        throw new Error('OCR library did not load (check your internet connection or an ad/content blocker)');
      }
      const w = await Tesseract.createWorker('eng');
      worker = w;
      return w;
    })().catch((err) => {
      // Don't cache a permanently-broken promise — let the next photo retry.
      workerReady = null;
      throw err;
    });
    return workerReady;
  }

  // ---------------------------------------------------------------
  // Extraction logic
  // ---------------------------------------------------------------
  // Finds every "Tracking ID" style label in the OCR text and pulls the
  // digit run that follows it. Numbers may be OCR'd with stray spaces or
  // dashes (FedEx labels often print numbers in grouped chunks), so we
  // capture a run of digits/spaces/dashes and strip down to digits only.
  const LABEL_RE = /track(?:ing)?\s*(?:id|no\.?|number|num|#)?\s*[:#\-]?\s*/gi;
  const RUN_RE = /[0-9][0-9\s\-]{6,40}[0-9]/;

  function extractCandidates(text) {
    const found = [];
    if (!text) return found;
    LABEL_RE.lastIndex = 0;
    let match;
    while ((match = LABEL_RE.exec(text)) !== null) {
      const windowStart = match.index + match[0].length;
      const window = text.slice(windowStart, windowStart + 90);
      const runMatch = window.match(RUN_RE);
      if (!runMatch) continue;
      const digits = runMatch[0].replace(/[^0-9]/g, '');
      if (digits.length >= 10 && digits.length <= 34) {
        found.push(digits);
      }
    }
    return found;
  }

  // ---------------------------------------------------------------
  // Length consensus
  // ---------------------------------------------------------------
  function detectedLength() {
    const counts = new Map();
    for (const e of state.entries) {
      counts.set(e.length, (counts.get(e.length) || 0) + 1);
    }
    let best = null;
    let bestCount = 0;
    for (const [len, count] of counts) {
      if (count > bestCount) {
        best = len;
        bestCount = count;
      }
    }
    return { length: best, count: bestCount, total: state.entries.length };
  }

  function targetLength() {
    if (lengthOverride.value !== 'auto') return parseInt(lengthOverride.value, 10);
    const d = detectedLength();
    return d.length;
  }

  function refreshLengthReadout() {
    const target = targetLength();
    if (!target || state.entries.length === 0) {
      lengthDetected.textContent = '—';
      return;
    }
    if (lengthOverride.value !== 'auto') {
      lengthDetected.textContent = `locked to ${target} digits`;
    } else {
      const d = detectedLength();
      lengthDetected.textContent = `${d.count} of ${d.total} match ${target} digits`;
    }
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  function renderQueue() {
    queueEl.innerHTML = '';
    for (const p of state.photos) {
      const li = document.createElement('li');
      li.className = 'queue-item';

      const img = document.createElement('img');
      img.className = 'queue-item__thumb';
      img.src = p.thumbUrl;
      img.alt = '';

      const body = document.createElement('div');
      body.className = 'queue-item__body';

      const name = document.createElement('p');
      name.className = 'queue-item__name';
      name.textContent = p.name;

      const status = document.createElement('p');
      status.className = 'queue-item__status is-' + p.status;
      status.textContent = statusLabel(p);

      body.appendChild(name);
      body.appendChild(status);
      li.appendChild(img);
      li.appendChild(body);
      queueEl.appendChild(li);
    }
  }

  function statusLabel(p) {
    switch (p.status) {
      case 'pending': return 'Queued';
      case 'scanning': return 'Reading…';
      case 'done': {
        const count = state.entries.filter(e => e.photoId === p.id).length;
        return count === 0 ? 'No tracking ID found' : `${count} number${count > 1 ? 's' : ''} found`;
      }
      case 'error': return p.error || 'Could not read photo';
      default: return '';
    }
  }

  function renderManifest() {
    const target = targetLength();

    if (state.entries.length === 0) {
      manifestEmpty.hidden = false;
      manifestTable.hidden = true;
    } else {
      manifestEmpty.hidden = true;
      manifestTable.hidden = false;
    }

    manifestBody.innerHTML = '';
    state.entries.forEach((entry, idx) => {
      const flagged = target ? entry.length !== target : false;
      const tr = document.createElement('tr');
      if (flagged) tr.classList.add('is-flagged');

      const tdLine = document.createElement('td');
      tdLine.className = 'col-line';
      tdLine.textContent = String(idx + 1).padStart(3, '0');

      const tdSrc = document.createElement('td');
      tdSrc.className = 'col-src';
      tdSrc.textContent = entry.photoName;
      tdSrc.title = entry.photoName;

      const tdNum = document.createElement('td');
      const input = document.createElement('input');
      input.className = 'tracking-input';
      input.type = 'text';
      input.value = entry.value;
      input.setAttribute('aria-label', `Tracking number ${idx + 1}`);
      input.addEventListener('input', () => {
        entry.value = input.value.trim();
        entry.length = entry.value.replace(/[^0-9]/g, '').length;
        renderManifest();
      });
      tdNum.appendChild(input);

      const tdLen = document.createElement('td');
      tdLen.className = 'col-len';
      tdLen.textContent = entry.length;

      const tdStatus = document.createElement('td');
      tdStatus.className = 'col-status';
      const badge = document.createElement('span');
      if (flagged) {
        badge.className = 'badge badge--flag';
        badge.textContent = `≠ ${target}`;
      } else if (entry.duplicate) {
        badge.className = 'badge badge--flag';
        badge.textContent = 'duplicate';
      } else {
        badge.className = 'badge badge--ok';
        badge.textContent = 'ok';
      }
      tdStatus.appendChild(badge);

      const tdActions = document.createElement('td');
      tdActions.className = 'col-actions';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'icon-btn';
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyText(entry.value, 'Tracking number copied'));

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn danger';
      delBtn.type = 'button';
      delBtn.textContent = 'Remove';
      delBtn.addEventListener('click', () => {
        state.entries = state.entries.filter(e => e !== entry);
        markDuplicates();
        renderManifest();
        refreshLengthReadout();
        updateStats();
      });

      tdActions.appendChild(copyBtn);
      tdActions.appendChild(delBtn);

      tr.appendChild(tdLine);
      tr.appendChild(tdSrc);
      tr.appendChild(tdNum);
      tr.appendChild(tdLen);
      tr.appendChild(tdStatus);
      tr.appendChild(tdActions);
      manifestBody.appendChild(tr);
    });

    const hasEntries = state.entries.length > 0;
    btnCopyAll.disabled = !hasEntries;
    btnExportCsv.disabled = !hasEntries;
    btnClear.disabled = state.photos.length === 0;
  }

  function markDuplicates() {
    const seen = new Map();
    for (const e of state.entries) {
      seen.set(e.value, (seen.get(e.value) || 0) + 1);
    }
    for (const e of state.entries) {
      e.duplicate = seen.get(e.value) > 1;
    }
  }

  function updateStats() {
    statPhotos.textContent = state.photos.filter(p => p.status === 'done' || p.status === 'error').length;
    statNumbers.textContent = state.entries.length;
  }

  // ---------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------
  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2200);
  }

  function copyText(text, message) {
    navigator.clipboard.writeText(text).then(
      () => toast(message),
      () => toast('Copy failed — select the text manually')
    );
  }

  // ---------------------------------------------------------------
  // File handling
  // ---------------------------------------------------------------
  function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/') || isLikelyHeic(f));
    if (files.length === 0) return;
    files.forEach(queuePhoto);
  }

  function isLikelyHeic(file) {
    const type = (file.type || '').toLowerCase();
    if (type.includes('heic') || type.includes('heif')) return true;
    const name = (file.name || '').toLowerCase();
    return name.endsWith('.heic') || name.endsWith('.heif');
  }

  function queuePhoto(file) {
    const id = 'p' + Math.random().toString(36).slice(2, 10);
    let thumbUrl;
    try {
      thumbUrl = URL.createObjectURL(file);
    } catch (e) {
      thumbUrl = '';
    }
    const photo = { id, name: file.name, thumbUrl, status: 'pending', error: null };
    state.photos.push(photo);
    renderQueue();
    updateStats();

    if (isLikelyHeic(file)) {
      photo.status = 'error';
      photo.error = 'HEIC photos aren\u2019t readable in-browser yet — share/export as JPEG or PNG first';
      renderQueue();
      updateStats();
      return;
    }

    processPhoto(photo, file);
  }

  async function processPhoto(photo, file) {
    photo.status = 'scanning';
    renderQueue();
    dropzone.classList.add('is-scanning');
    try {
      const source = await downscaleImage(file);
      const w = await ensureWorker();
      engineStatus.hidden = true;
      const { data } = await w.recognize(source);
      const candidates = extractCandidates(data.text || '');

      for (const value of candidates) {
        state.lineCounter += 1;
        state.entries.push({
          id: 'e' + state.lineCounter,
          photoId: photo.id,
          photoName: photo.name,
          value,
          length: value.length,
          duplicate: false,
        });
      }
      markDuplicates();
      photo.status = 'done';
    } catch (err) {
      console.error('OCR failed for', photo.name, err);
      photo.status = 'error';
      photo.error = describeError(err);
    } finally {
      renderQueue();
      renderManifest();
      refreshLengthReadout();
      updateStats();
      if (!state.photos.some(p => p.status === 'scanning')) {
        dropzone.classList.remove('is-scanning');
      }
    }
  }

  function describeError(err) {
    const msg = (err && err.message) ? err.message : String(err || '');
    if (/did not load|fetch|network/i.test(msg)) {
      return 'OCR engine failed to load — check your connection or an ad/content blocker, then reload';
    }
    if (/decode|source width|source height|createImageBitmap/i.test(msg)) {
      return 'Could not read this image format — try re-saving it as JPEG or PNG';
    }
    return msg ? `Could not read photo — ${msg}` : 'Could not read photo';
  }

  // Downscale large photos on a canvas before OCR — keeps everything
  // in-memory (no upload) and speeds up recognition on big camera photos.
  // Falls back to handing Tesseract the original file if the browser
  // can't decode it onto a canvas (Tesseract's own decoder sometimes
  // succeeds on files createImageBitmap rejects).
  async function downscaleImage(file) {
    const MAX_DIM = 2000;
    try {
      const imgBitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_DIM / Math.max(imgBitmap.width, imgBitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(imgBitmap.width * scale));
      canvas.height = Math.max(1, Math.round(imgBitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);
      imgBitmap.close && imgBitmap.close();
      return canvas;
    } catch (err) {
      console.warn('Downscale skipped, passing original file to OCR engine', err);
      return file;
    }
  }

  // ---------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------
  function exportCsv() {
    const rows = [['Line', 'Source photo', 'Tracking number', 'Digits', 'Status']];
    const target = targetLength();
    state.entries.forEach((e, idx) => {
      const flagged = target ? e.length !== target : false;
      const status = flagged ? `check length (expected ${target})` : (e.duplicate ? 'duplicate' : 'ok');
      rows.push([idx + 1, e.photoName, e.value, e.length, status]);
    });
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tracking-manifest.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function csvEscape(value) {
    const s = String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ---------------------------------------------------------------
  // Wire up UI
  // ---------------------------------------------------------------
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });

  lengthOverride.addEventListener('change', () => {
    renderManifest();
    refreshLengthReadout();
  });

  btnCopyAll.addEventListener('click', () => {
    const text = state.entries.map(e => e.value).join('\n');
    copyText(text, `Copied ${state.entries.length} tracking number${state.entries.length === 1 ? '' : 's'}`);
  });

  btnExportCsv.addEventListener('click', exportCsv);

  btnClear.addEventListener('click', () => {
    for (const p of state.photos) URL.revokeObjectURL(p.thumbUrl);
    state.photos = [];
    state.entries = [];
    state.lineCounter = 0;
    renderQueue();
    renderManifest();
    refreshLengthReadout();
    updateStats();
    toast('Cleared');
  });

  // Warm the OCR worker as soon as the page loads so the first photo
  // does not wait on model download + init. If this fails outright
  // (CDN blocked, no network, etc.) surface it clearly rather than
  // letting every photo fail with a generic error one at a time.
  ensureWorker()
    .then(() => {
      engineStatus.hidden = true;
    })
    .catch((err) => {
      console.error('OCR engine failed to initialize', err);
      engineStatus.hidden = false;
      engineStatus.textContent =
        'The OCR engine could not load, so photos can\u2019t be read yet. ' +
        'This usually means the page can\u2019t reach cdn.jsdelivr.net — check your connection, ' +
        'disable any ad/content blocker for this site, then reload the page.';
    });
})();
