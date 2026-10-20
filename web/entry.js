let entrySession = null;
let handwritingWorker = null;
let handwritingJob = null;

function stopEntrySession() {
  if (!entrySession) return;
  clearTimeout(entrySession.lookupTimer);
  clearTimeout(entrySession.inkTimer);
  entrySession.controller?.abort();
  entrySession.resizeObserver?.disconnect();
  entrySession.active = false;
  entrySession = null;
}

function openEntry(id, initial = '') {
  stopEntrySession();
  const w = words().find(word => word.id === id) || {};
  const session = entrySession = { active: true, id, lookupSequence: 0, inkRevision: 0, resolvedWord: w.word ? KelimeLookup.normalize(w.word) : '', data: w };
  openModal(`
    <p class="eyebrow">SADECE KELİMENİ YAZ</p>
    <h2>${id ? 'Kelimeyi düzenle.' : 'Sen kelimeyi yaz, gerisini bulalım.'}</h2>
    <p class="entry-intro">Türkçe anlamı, İngilizce eş anlamlısı ve varsa zıt anlamlısı otomatik dolsun.</p>
    <div class="tabs" role="group" aria-label="Kelime giriş yöntemi">
      <button id="keyboard-tab" class="${entryMode === 'keyboard' ? 'selected' : ''}" type="button">${icon('pencil')}Klavye / Karalama</button>
      <button id="pencil-tab" class="${entryMode === 'pencil' ? 'selected' : ''}" type="button">Kalemle yaz</button>
    </div>
    <div id="pencil-panel" class="${entryMode === 'pencil' ? '' : 'hidden'}">
      <div class="ink-heading"><span>İngilizce kelimeni tek satırda yaz.</span><span>Apple Pencil / parmak</span></div>
      <div class="ink-wrap"><canvas class="pencil-area" id="pencil-canvas" aria-label="Tanınacak İngilizce kelimeyi kalemle yaz"></canvas><span id="ink-placeholder">buraya yaz…</span></div>
      <div class="ink-actions"><button class="quiet" id="clear-canvas" type="button">Temizle</button><button class="secondary" id="recognize-ink" type="button">${icon('pencil')}Yazıyı tanı</button></div>
      <label class="auto-ink"><input type="checkbox" id="auto-recognize" checked>Yazmayı bitirince otomatik tanı</label>
      <p id="ink-status" class="ink-status" role="status">El yazısı cihazında tanınır. İlk kullanımda model indirilir; biraz sürebilir.</p>
    </div>
    <form id="entry-form">
      <label class="field entry-main-field"><span id="entry-word-label">${entryMode === 'pencil' ? 'Tanınan kelime · gerekirse düzeltebilirsin' : 'Bugün öğrendiğin İngilizce kelime'}</span>
        <div class="word-input-wrap"><input name="word" id="entry-word" required maxlength="80" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="Örn. generous" value="${esc(w.word || initial)}"><span class="input-spark">✧</span></div>
      </label>
      <div id="lookup-status" class="lookup-status" role="status" aria-live="polite">${w.word ? 'Kayıtlı kelime bilgilerin.' : 'Kelimeyi yazdığında anlamlarını senin için bulacağız.'}</div>
      <div id="lookup-preview" class="lookup-preview ${w.word ? '' : 'hidden'}"></div>
      <button class="quiet hidden" id="retry-lookup" type="button">↻ Yeniden ara</button>
      <details class="entry-details" ${id ? 'open' : ''}>
        <summary>Bilgileri düzenle / tarih değiştir</summary>
        <label class="field">Türkçe anlamı<input name="tr" maxlength="200" placeholder="Otomatik doldurulur" value="${esc(w.tr || '')}"></label>
        <div class="field-row"><label class="field">İngilizce eş anlamlısı<input name="synonym" maxlength="150" placeholder="Otomatik doldurulur" value="${esc(w.synonym || '')}"></label><label class="field">Zıt anlamlısı (varsa)<input name="antonym" maxlength="150" placeholder="Varsa otomatik doldurulur" value="${esc(w.antonym || '')}"></label></div>
        <div class="field-row"><label class="field">Kelime türü<select name="type">${[['', 'Seçebilirsin'], ['noun', 'İsim · noun'], ['verb', 'Fiil · verb'], ['adjective', 'Sıfat · adjective'], ['adverb', 'Zarf · adverb'], ['pronoun', 'Zamir · pronoun'], ['preposition', 'Edat · preposition'], ['conjunction', 'Bağlaç · conjunction'], ['determiner', 'Belirleyici · determiner'], ['interjection', 'Ünlem · interjection'], ['phrase', 'İfade · phrase'], ['other', 'Diğer']].map(([value, label]) => `<option value="${value}" ${w.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">Öğrenme tarihi<input name="date" type="date" required max="${dayKey()}" value="${w.date || dayKey()}"></label></div>
        <label class="field">Örnek cümle<textarea name="example" maxlength="500" placeholder="Kaynakta varsa otomatik eklenir">${esc(w.example || '')}</textarea></label>
      </details>
      <div class="entry-service-note">Kelime bilgileri için yalnızca yazdığın kelime çevrim içi sözlük ve çeviri hizmetlerine gönderilir.</div>
      <p id="entry-error" class="entry-error" role="alert"></p>
      <div class="modal-actions"><button class="secondary" type="button" id="cancel-entry">Vazgeç</button><button class="primary" id="save-entry" type="submit">${icon('check')}${id ? 'Değişiklikleri kaydet' : 'Defterime ekle'}</button></div>
    </form>`);
  session.form = document.getElementById('entry-form');
  const input = session.form.elements.word;
  document.getElementById('cancel-entry').onclick = closeModal;
  ['keyboard', 'pencil'].forEach(mode => {
    document.getElementById(mode + '-tab').onclick = () => {
      entryMode = mode;
      document.getElementById('pencil-panel').classList.toggle('hidden', mode !== 'pencil');
      document.getElementById('keyboard-tab').classList.toggle('selected', mode === 'keyboard');
      document.getElementById('pencil-tab').classList.toggle('selected', mode === 'pencil');
      document.getElementById('entry-word-label').textContent = mode === 'pencil' ? 'Tanınan kelime · gerekirse düzeltebilirsin' : 'Bugün öğrendiğin İngilizce kelime';
      if (mode === 'pencil') setupCanvas(); else input.focus();
    };
  });
  input.addEventListener('compositionstart', () => session.composing = true);
  input.addEventListener('compositionend', () => { session.composing = false; queueEntryLookup(session); });
  input.addEventListener('input', () => { if (!session.composing) queueEntryLookup(session); });
  session.form.addEventListener('input', event => {
    if (event.target.name && event.target.name !== 'word' && session.resolvedWord) renderEntryPreview(session);
  });
  input.addEventListener('blur', () => { if (KelimeLookup.validWord(input.value.trim()) && session.resolvedWord !== KelimeLookup.normalize(input.value)) resolveEntryWord(session); });
  document.getElementById('retry-lookup').onclick = () => resolveEntryWord(session, true);
  session.form.onsubmit = async event => {
    event.preventDefault();
    const word = KelimeLookup.normalize(input.value);
    if (!KelimeLookup.validWord(word)) return entryError('İngilizce kelimeni harflerle yaz.');
    if (words().some(existing => KelimeLookup.normalize(existing.word) === word && existing.id !== id)) return entryError('Bu kelime zaten defterinde. Kelime defterinden düzenleyebilirsin.');
    if (session.resolvedWord !== word) await resolveEntryWord(session);
    if (!session.active || KelimeLookup.normalize(input.value) !== word) return;
    const data = Object.fromEntries(new FormData(session.form));
    Object.keys(data).forEach(key => data[key] = data[key].trim());
    if (!data.date || data.date > dayKey()) return entryError('Geçerli bir öğrenme tarihi seç.');
    const entry = { ...session.data, ...data, word, id: id || crypto.randomUUID(), lookupPending: !data.tr };
    if (notebook.demo) { notebook.words = words(); notebook.demo = false; }
    const position = notebook.words.findIndex(existing => existing.id === id);
    if (position >= 0) notebook.words[position] = entry; else notebook.words.push(entry);
    persist();
    closeModal();
    render();
    toast(data.tr ? (id ? 'Kelime güncellendi.' : word + ' anlamlarıyla defterine eklendi.') : 'Kelime kaydedildi. Anlamını daha sonra yeniden arayabilirsin.');
  };
  if (w.word) renderEntryPreview(session);
  if (entryMode === 'pencil') setupCanvas(); else input.focus();
  if (initial && !w.word) queueEntryLookup(session);
}

function entryError(message) { const element = document.getElementById('entry-error'); if (element) element.textContent = message; }

function queueEntryLookup(session) {
  clearTimeout(session.lookupTimer);
  session.controller?.abort();
  session.lookupSequence++;
  session.pending = null;
  session.resolvedWord = '';
  session.data = {};
  ['tr', 'synonym', 'antonym', 'type', 'example'].forEach(key => session.form.elements[key].value = '');
  document.getElementById('lookup-preview').classList.add('hidden');
  document.getElementById('retry-lookup').classList.add('hidden');
  setEntryBusy(false);
  entryError('');
  const word = session.form.elements.word.value.trim();
  document.getElementById('lookup-status').classList.remove('lookup-success');
  document.getElementById('lookup-status').textContent = word ? 'Yazmayı bitirince anlamları aranacak…' : 'Kelimeyi yazdığında anlamlarını senin için bulacağız.';
  if (KelimeLookup.validWord(word)) session.lookupTimer = setTimeout(() => resolveEntryWord(session), 650);
}

function setEntryBusy(busy, label = 'Anlamlar bulunuyor…') {
  const button = document.getElementById('save-entry');
  if (!button || !entrySession) return;
  button.disabled = busy;
  button.innerHTML = busy ? '<span class="entry-spinner"></span>' + esc(label) : icon('check') + (entrySession.id ? 'Değişiklikleri kaydet' : 'Defterime ekle');
}

async function resolveEntryWord(session, refresh = false) {
  if (!session.active) return;
  clearTimeout(session.lookupTimer);
  const word = KelimeLookup.normalize(session.form.elements.word.value);
  if (!KelimeLookup.validWord(word)) return;
  if (!refresh && session.resolvedWord === word) return session.data;
  if (!refresh && session.pendingWord === word && session.pending) return session.pending;
  session.controller?.abort();
  session.controller = new AbortController();
  const sequence = ++session.lookupSequence;
  session.pendingWord = word;
  setEntryBusy(true);
  document.getElementById('lookup-status').innerHTML = '<span class="entry-spinner"></span>Türkçe anlamı ve kelime karşılıkları bulunuyor…';
  session.pending = (async () => {
    try {
      const data = await KelimeLookup.lookup(word, { signal: session.controller.signal, refresh });
      if (!session.active || sequence !== session.lookupSequence || word !== KelimeLookup.normalize(session.form.elements.word.value)) return;
      session.data = data;
      session.resolvedWord = word;
      ['tr', 'synonym', 'antonym', 'type', 'example'].forEach(key => session.form.elements[key].value = data[key] || '');
      renderEntryPreview(session);
      const status = document.getElementById('lookup-status');
      status.textContent = data.dictionaryStatus === 'not-found' && !data.verified ? 'Kelime sözlükte bulunamadı. Yazımını kontrol et; istersen anlamı bekleniyor olarak ekleyebilirsin.'
        : data.translationRejected ? 'Geçersiz çeviri elendi; Türkçe anlam eklenmedi. Tekrar arayabilir veya kelimeyi anlamı bekleniyor olarak ekleyebilirsin.'
        : !data.tr ? 'Türkçe anlama şu anda ulaşılamadı. Tekrar arayabilir veya kelimeyi anlamı bekleniyor olarak ekleyebilirsin.'
        : data.reviewed ? 'Temel kullanım bilgisi hazır. İstersen düzenleyip defterine ekle.'
        : data.lemma ? 'Kelimenin kökü sözlükte bulundu; anlamları hazır.'
        : data.multipleMeanings ? 'Kelime bilgileri hazır. Birden fazla anlamı var; öğrendiğin cümle hangi anlamda kullanıldığını belirler.'
        : 'Kelime bilgileri hazır. Defterine ekleyebilirsin.';
      status.classList.toggle('lookup-success', !!data.tr && data.reviewed === true);
      document.getElementById('retry-lookup').classList.toggle('hidden', !!data.tr && data.synonymStatus !== 'unavailable' && data.antonymStatus !== 'unavailable');
      return data;
    } catch (error) {
      if (!session.active || sequence !== session.lookupSequence || error.name === 'AbortError') return;
      session.resolvedWord = word;
      session.data = { word, lookupPending: true };
      document.getElementById('lookup-status').textContent = 'Sözlük bağlantısı kurulamadı. Yeniden dene veya kelimeyi anlamı bekleniyor olarak kaydet.';
      document.getElementById('retry-lookup').classList.remove('hidden');
    } finally {
      if (session.active && sequence === session.lookupSequence) { session.pending = null; setEntryBusy(false); }
    }
  })();
  return session.pending;
}

function renderEntryPreview(session) {
  const data = session.data || {};
  const missing = (key) => data[key + 'Status'] === 'context-required' ? 'Anlama göre değişir; otomatik seçilmedi' : data[key + 'Status'] === 'not-applicable' ? 'Bu kullanımda doğrudan karşılığı yok' : data[key + 'Status'] === 'unavailable' ? 'Şu anda ulaşılamadı' : 'Kaynakta bulunamadı';
  const element = document.getElementById('lookup-preview');
  element.classList.remove('hidden');
  element.innerHTML = `<div class="lookup-translation"><span class="eyebrow">${data.source === 'online' ? 'TÜRKÇE ÇEVİRİ ÖNERİSİ' : 'TÜRKÇE ANLAMI'}</span><strong>${esc(session.form.elements.tr.value || 'Anlamı bekleniyor')}</strong><small>${esc(data.formTypes?.length > 1 && session.form.elements.type.value === data.type ? data.formTypes.map(KelimeLookup.typeLabel).join(' / ') : KelimeLookup.typeLabel(session.form.elements.type.value || data.type))}</small></div>
    ${data.lemma ? `<p class="lookup-footnote"><b>Kök kelime: ${esc(data.lemma)}</b> · ${esc(data.word)} ${esc(data.form)} biçimidir. Aşağıdaki tanım ve eş/zıt anlamlar kök kelimeye aittir. Cümlede isim veya sıfat görevinde de kullanılabilir.</p>` : ''}
    <div class="lookup-relations"><div><span>EŞ ANLAMLISI</span><strong>${esc(session.form.elements.synonym.value || missing('synonym'))}</strong></div><div><span>ZIT ANLAMLISI</span><strong>${esc(session.form.elements.antonym.value || missing('antonym'))}</strong></div></div>
    ${data.definition ? `<p class="lookup-definition">${esc(data.definition)}</p>` : ''}
    <div class="lookup-footnote">${data.reviewed ? 'Temel kullanım için gözden geçirilmiş kelime bilgisi. Eş ve zıt anlam alanları bu kullanım içindir.' : data.source === 'online' ? 'Çeviriler kelime eşleşmesi, dil etiketi ve sonuç biçimi açısından denetlenir. Bu denetimler anlam doğruluğunu garanti etmez; çok anlamlı kelimelerde cümle anlamı belirler.' : 'Karşılıklar bağlama göre değişebilir.'}${data.source === 'online' ? ' <a href="https://dictionaryapi.dev/" target="_blank" rel="noopener noreferrer">Sözlük</a> · <a href="https://www.datamuse.com/api/" target="_blank" rel="noopener noreferrer">Datamuse</a> · <a href="https://mymemory.translated.net/" target="_blank" rel="noopener noreferrer">MyMemory</a>' : ''}${data.sourceUrl ? ` · <a href="${esc(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">Wiktionary (${esc(data.license || 'CC BY-SA 3.0')})</a>` : ''}</div>`;
}

function setupCanvas() {
  const session = entrySession;
  const canvas = document.getElementById('pencil-canvas');
  if (!session || !canvas || canvas.dataset.ready || !canvas.clientWidth) return;
  canvas.dataset.ready = '1';
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let drawing = false;
  let lastWidth = 0;
  function resize() {
    if (!canvas.clientWidth || canvas.clientWidth === lastWidth) return;
    const old = document.createElement('canvas'); old.width = canvas.width; old.height = canvas.height;
    old.getContext('2d').drawImage(canvas, 0, 0);
    lastWidth = canvas.clientWidth;
    const ratio = devicePixelRatio || 1;
    canvas.width = lastWidth * ratio; canvas.height = 170 * ratio;
    context.drawImage(old, 0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.strokeStyle = '#263b28'; context.lineCap = 'round'; context.lineJoin = 'round';
  }
  resize();
  session.resizeObserver = new ResizeObserver(resize);
  session.resizeObserver.observe(canvas);
  const position = event => { const rect = canvas.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top]; };
  canvas.onpointerdown = event => {
    if (event.pointerType === 'touch' && session.penActive) return;
    event.preventDefault();
    if (event.pointerType === 'pen') session.penActive = true;
    clearTimeout(session.inkTimer);
    session.inkRevision++;
    drawing = true; canvas.setPointerCapture(event.pointerId);
    context.lineWidth = event.pointerType === 'pen' ? 2.3 + (event.pressure || .5) * 2 : 3;
    context.beginPath(); context.moveTo(...position(event));
    document.getElementById('ink-placeholder').classList.add('hidden');
  };
  canvas.onpointermove = event => {
    if (!drawing || !canvas.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    for (const point of event.getCoalescedEvents?.() || [event]) context.lineTo(...position(point));
    context.stroke();
  };
  canvas.onpointerup = canvas.onpointercancel = event => {
    if (!drawing || !canvas.hasPointerCapture(event.pointerId)) return;
    drawing = false;
    if (event.pointerType === 'pen') session.penActive = false;
    if (document.getElementById('auto-recognize').checked) session.inkTimer = setTimeout(() => recognizeInk(session), 1500);
  };
  document.getElementById('clear-canvas').onclick = () => {
    clearTimeout(session.inkTimer); session.inkRevision++;
    context.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('ink-placeholder').classList.remove('hidden');
    document.getElementById('ink-status').textContent = 'Alan temizlendi. Yeni kelimeni yazabilirsin.';
  };
  document.getElementById('recognize-ink').onclick = () => recognizeInk(session);
  document.getElementById('auto-recognize').onchange = event => { if (!event.target.checked) clearTimeout(session.inkTimer); };
}

function cropInk(canvas) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let left = width, right = 0, top = height, bottom = 0, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (pixels[i + 3] > 32 && pixels[i] + pixels[i + 1] + pixels[i + 2] < 630) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
    }
  }
  if (count < 30 || right - left < 8) return null;
  const crop = document.createElement('canvas');
  const padding = Math.max(12, Math.round((bottom - top) * .18));
  crop.width = right - left + 1 + padding * 2; crop.height = bottom - top + 1 + padding * 2;
  const ctx = crop.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.drawImage(canvas, left, top, right - left + 1, bottom - top + 1, padding, padding, right - left + 1, bottom - top + 1);
  return crop.toDataURL('image/png');
}

function runHandwriting(image, progress) {
  return new Promise((resolve, reject) => {
    if (handwritingJob) return reject(new Error('Önceki yazı hâlâ tanınıyor. Birazdan yeniden dene.'));
    if (!handwritingWorker) handwritingWorker = new Worker('handwriting-worker.js', { type: 'module' });
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      handwritingWorker?.terminate(); handwritingWorker = null; handwritingJob = null;
      reject(new Error('El yazısı modeli zamanında yüklenemedi. İnternetini kontrol edip tekrar dene.'));
    }, 240000);
    handwritingJob = { id };
    const finish = () => { clearTimeout(timeout); handwritingJob = null; };
    handwritingWorker.onmessage = ({ data }) => {
      if (data.id !== id) return;
      if (data.type === 'result') { finish(); resolve(data.text); }
      else if (data.type === 'error') { finish(); reject(new Error('Yazı tanıma çalıştırılamadı. Yeniden deneyebilir veya Klavye / Karalama alanına yazabilirsin.')); }
      else progress(data);
    };
    handwritingWorker.onerror = () => {
      finish(); handwritingWorker?.terminate(); handwritingWorker = null;
      reject(new Error('Bu tarayıcıda el yazısı modeli başlatılamadı. Klavye / Karalama alanına Apple Pencil ile de yazabilirsin.'));
    };
    handwritingWorker.postMessage({ id, image });
  });
}

async function recognizeInk(session) {
  clearTimeout(session.inkTimer);
  if (!session.active || session.recognizing) return;
  const canvas = document.getElementById('pencil-canvas');
  const image = cropInk(canvas);
  const status = document.getElementById('ink-status');
  if (!image) { status.textContent = 'Önce alana İngilizce kelimeni yaz.'; return; }
  const revision = session.inkRevision;
  const inputSnapshot = session.form.elements.word.value;
  const lookupSequence = session.lookupSequence;
  session.recognizing = true;
  document.getElementById('recognize-ink').disabled = true;
  setEntryBusy(true, 'Yazın okunuyor…');
  try {
    const raw = await runHandwriting(image, data => {
      if (!session.active) return;
      status.textContent = data.type === 'recognizing' ? 'Yazın okunuyor…' : data.type === 'progress'
        ? 'El yazısı modeli indiriliyor: %' + data.progress + ' (ilk kullanım)…'
        : 'El yazısı modeli hazırlanıyor. İlk kullanımda biraz sürebilir…';
    });
    if (!session.active) return;
    if (revision !== session.inkRevision) { status.textContent = 'Yazın değişti. Son çizim tanınacak.'; return; }
    if (session.form.elements.word.value !== inputSnapshot || session.lookupSequence !== lookupSequence) {
      status.textContent = 'Kelime kutusundaki düzeltmen korundu. Çizimi yeniden okutmak için Yazıyı tanı düğmesini kullan.';
      return;
    }
    const text = raw.trim().replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').replace(/\s+/g, ' ');
    if (!KelimeLookup.validWord(text)) { status.textContent = 'Kelime net okunamadı. Harfleri biraz daha büyük yazıp yeniden dene.'; return; }
    session.form.elements.word.value = text;
    status.textContent = 'Tanınan kelime: “' + text + '”. Yanlışsa aşağıdaki kutudan düzeltebilirsin.';
    queueEntryLookup(session);
    resolveEntryWord(session);
  } catch (error) {
    if (session.active) status.textContent = error.message;
  } finally {
    session.recognizing = false;
    if (session.active) {
      document.getElementById('recognize-ink').disabled = false;
      setEntryBusy(!!session.pending);
      if (revision !== session.inkRevision && document.getElementById('auto-recognize').checked) session.inkTimer = setTimeout(() => recognizeInk(session), 400);
    }
  }
}
