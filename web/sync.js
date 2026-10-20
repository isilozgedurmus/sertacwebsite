/* Account-scoped notebook synchronization. API authentication stays in the platform cookie. */
(function (root) {
  'use strict';
  const DEVICE_KEY = 'kelime-sync-device-v1';
  const OWNER_KEY = 'kelime-sync-owner-v1';
  const BACKUP_KEY = 'kelime-sync-migration-backup-v1';
  const NOTEBOOK_KEY = 'kelime-notebook-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const wordKey = word => String(word || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const recordKey = (kind, record) => kind === 'words' ? (record.id ? 'id:' + String(record.id) : 'word:' + wordKey(record.word)) : String(record.date || '') + '|' + String(record.type || '');
  const legacyTime = date => /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? Math.max(0, Date.parse(date + 'T00:00:00Z') || 0) : 0;
  const timeOf = record => Number.isSafeInteger(record?._updatedAt) && record._updatedAt >= 0 ? record._updatedAt : legacyTime(record?.date);
  const literal = value => JSON.stringify(value)?.replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => literal(key) + ':' + stable(value[key])).join(',') + '}';
    return literal(value);
  }
  function payload(record) {
    const copy = { ...record };
    delete copy._updatedAt; delete copy._updatedBy;
    return copy;
  }
  function choose(left, right) {
    if (!left) return right;
    if (!right) return left;
    const difference = timeOf(left) - timeOf(right);
    if (difference) return difference > 0 ? left : right;
    const actorLeft = String(left._updatedBy || ''), actorRight = String(right._updatedBy || '');
    if (actorLeft !== actorRight) return actorLeft > actorRight ? left : right;
    // Legacy records have no edit history. Prefer the more complete copy, then a stable tie-break.
    const leftBody = stable(payload(left)), rightBody = stable(payload(right));
    if (!actorLeft && leftBody.length !== rightBody.length) return leftBody.length > rightBody.length ? left : right;
    return leftBody >= rightBody ? left : right;
  }
  function emptyNotebook() { return { demo: false, words: [], passages: [], sessions: [], notes: {}, _noteModified: {} }; }
  function collapseWords(input) {
    // A spelling edit keeps the record ID: resolve that edit before deduplicating spelling.
    const byId = new Map(), byWord = new Map();
    for (const record of input) {
      const id = recordKey('words', record);
      byId.set(id, choose(byId.get(id), record));
    }
    for (const record of byId.values()) {
      const key = wordKey(record.word);
      byWord.set(key, choose(byWord.get(key), record));
    }
    return [...byWord].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, record]) => clone(record));
  }
  function normalizeNotebook(input) {
    const result = emptyNotebook();
    if (!input || input.demo === true) return result;
    for (const kind of ['words', 'passages', 'sessions']) {
      const records = new Map();
      for (const record of Array.isArray(input[kind]) ? input[kind] : []) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
        if (kind === 'words' && (typeof record.word !== 'string' || !wordKey(record.word))) continue;
        if (kind !== 'words' && (!/^\d{4}-\d{2}-\d{2}$/.test(String(record.date)) || !record.type)) continue;
        const normalized = { ...clone(record), _updatedAt: timeOf(record), _updatedBy: String(record._updatedBy || '') };
        const key = recordKey(kind, normalized);
        records.set(key, choose(records.get(key), normalized));
      }
      result[kind] = kind === 'words' ? collapseWords([...records.values()]) : [...records].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, record]) => record);
    }
    for (const date of Object.keys(input.notes || {}).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof input.notes[date] !== 'string') continue;
      result.notes[date] = input.notes[date];
      const info = input._noteModified?.[date];
      result._noteModified[date] = {
        updatedAt: Number.isSafeInteger(info?.updatedAt) && info.updatedAt >= 0 ? info.updatedAt : legacyTime(date),
        updatedBy: String(info?.updatedBy || ''),
      };
    }
    return result;
  }
  function mergeNotebooks(left, right) {
    const a = normalizeNotebook(left), b = normalizeNotebook(right), result = emptyNotebook();
    for (const kind of ['words', 'passages', 'sessions']) {
      if (kind === 'words') { result.words = collapseWords([...a.words, ...b.words]); continue; }
      const records = new Map();
      for (const record of [...a[kind], ...b[kind]]) {
        const key = recordKey(kind, record);
        records.set(key, choose(records.get(key), record));
      }
      result[kind] = [...records].sort(([x], [y]) => x.localeCompare(y, 'en')).map(([, record]) => clone(record));
    }
    for (const date of [...new Set([...Object.keys(a.notes), ...Object.keys(b.notes)])].sort()) {
      const get = state => date in state.notes ? { value: state.notes[date], _updatedAt: state._noteModified[date].updatedAt, _updatedBy: state._noteModified[date].updatedBy } : null;
      const note = choose(get(a), get(b));
      result.notes[date] = note.value;
      result._noteModified[date] = { updatedAt: note._updatedAt, updatedBy: note._updatedBy };
    }
    return result;
  }
  function stampChanges(previous, current, device, now = Date.now()) {
    if (current?.demo === true) return clone(current);
    const old = normalizeNotebook(previous), next = normalizeNotebook(current);
    for (const kind of ['words', 'passages', 'sessions']) {
      const before = new Map(old[kind].map(record => [recordKey(kind, record), record]));
      next[kind] = next[kind].map(record => {
        const existing = before.get(recordKey(kind, record));
        if (existing && stable(payload(existing)) === stable(payload(record))) {
          return choose(existing, record);
        }
        return { ...record, _updatedAt: Math.max(now, timeOf(existing) + 1, timeOf(record) + 1), _updatedBy: device };
      });
    }
    for (const date of Object.keys(next.notes)) {
      if (old.notes[date] !== next.notes[date]) next._noteModified[date] = {
        updatedAt: Math.max(now, (old._noteModified[date]?.updatedAt || 0) + 1, next._noteModified[date].updatedAt + 1), updatedBy: device,
      };
    }
    return next;
  }

  function create(options) {
    if (!options || typeof options.getNotebook !== 'function' || typeof options.setNotebook !== 'function') throw new TypeError('Notebook callbacks are required.');
    let storage = options.storage;
    if (storage === undefined) { try { storage = root.localStorage; } catch {} }
    const read = key => { try { return storage?.getItem(key) || ''; } catch { return ''; } };
    const write = (key, value) => { if (storage) storage.setItem(key, value); };
    const fetcher = options.fetch || root.fetch?.bind(root);
    const eventTarget = options.eventTarget === undefined ? root : options.eventTarget;
    const doc = options.document === undefined ? root.document : options.document;
    const navigator = options.navigator === undefined ? root.navigator : options.navigator;
    const now = options.now || Date.now;
    const schedule = options.setTimeout || setTimeout;
    const cancel = options.clearTimeout || clearTimeout;
    const endpoint = options.endpoint || '/api/sync';
    const pollMs = options.pollInterval === undefined ? 25000 : options.pollInterval;
    const debounceMs = options.debounce === undefined ? 500 : options.debounce;
    let device = read(DEVICE_KEY);
    if (!device) {
      device = root.crypto?.randomUUID?.() || 'device-' + now().toString(36) + '-' + Math.random().toString(36).slice(2);
      try { write(DEVICE_KEY, device); } catch {}
    }
    let snapshot = clone(options.getNotebook());
    let state = { state: 'idle', label: 'Eşitleme hazırlanıyor', lastSyncedAt: null, user: null };
    let started = false, disposed = false, blocked = false, busy = null, again = false;
    let debounceTimer, retryTimer, pollTimer, controller, channel;
    let failures = 0;
    let currentUser = null;
    let revision = 0;
    function status(code, label, extra = {}) {
      state = { ...state, state: code, label, user: currentUser, ...extra };
      try { options.onStatus?.({ ...state }); } catch {}
    }
    function online() { return navigator?.onLine !== false; }
    function visible() { return !doc || doc.visibilityState !== 'hidden'; }
    function actual() {
      const raw = options.getNotebook();
      if (raw?.demo === true) { snapshot = clone(raw); return null; }
      const stamped = stampChanges(snapshot, raw, device, now());
      apply(stamped, 'local');
      return stamped;
    }
    function apply(notebook, source) {
      const copy = clone(notebook);
      const different = stable(options.getNotebook()) !== stable(copy);
      snapshot = copy;
      if (different) options.setNotebook(clone(copy), { source });
      return different;
    }
    function backup() {
      const raw = options.getNotebook();
      if (raw?.demo === true || read(BACKUP_KEY)) return;
      try { write(BACKUP_KEY, JSON.stringify({ savedAt: now(), ownerId: read(OWNER_KEY) || null, notebook: raw })); }
      catch { throw Object.assign(new Error('İlk bulut aktarımından önce cihaz yedeği kaydedilemedi. Defterini dışa aktarıp cihazda yer aç. Kayıtların değiştirilmedi.'), { localBackup: true }); }
    }
    function identity(user) {
      if (!user || typeof user.id !== 'string' || !user.id) throw new Error('Oturum bilgisi doğrulanamadı.');
      const owner = read(OWNER_KEY) || currentUser?.id;
      if (owner && owner !== user.id) {
        blocked = true;
        status('account-mismatch', 'Bu cihazdaki defter başka bir hesaba bağlı. Önce aynı ChatGPT hesabıyla giriş yap.', { expectedOwner: owner, signedInUser: { id: user.id }, error: null });
        return false;
      }
      currentUser = { id: user.id, ...(typeof user.email === 'string' ? { email: user.email } : {}) };
      try { write(OWNER_KEY, user.id); } catch {}
      return true;
    }
    function validate(response) {
      if (!response || !Number.isSafeInteger(response.revision) || response.revision < 0 || !response.user?.id
          || (response.notebook !== null && (!response.notebook || !Array.isArray(response.notebook.words) || !Array.isArray(response.notebook.passages) || !Array.isArray(response.notebook.sessions)))) {
        throw new Error('Bulut yanıtı doğrulanamadı. Cihazdaki kayıtların korunuyor.');
      }
      return response;
    }
    async function request(method, body) {
      if (typeof fetcher !== 'function') throw new Error('Bu tarayıcıda eşitleme desteklenmiyor.');
      controller = new AbortController();
      const timeout = schedule(() => controller?.abort(), options.timeout || 15000);
      try {
        const response = await fetcher(endpoint, {
          method, credentials: 'same-origin', cache: 'no-store', redirect: 'manual', signal: controller.signal,
          headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) throw Object.assign(new Error('Eşitlemek için aynı ChatGPT hesabıyla giriş yap.'), { authentication: true });
        if (response.status === 404) throw Object.assign(new Error('Bu önizlemede bulut bağlantısı yok. Kayıtların cihazında saklanıyor.'), { unsupported: true });
        if (!response.ok && response.status !== 409) throw new Error('Buluta şu anda ulaşılamıyor. Kayıtların cihazında saklanıyor.');
        const data = validate(await response.json());
        return { data, conflict: response.status === 409 };
      } finally { cancel(timeout); controller = null; }
    }
    function retry() {
      cancel(retryTimer);
      if (disposed || blocked) return;
      const delay = Math.min(60000, 3000 * 2 ** Math.min(failures++, 5));
      retryTimer = schedule(() => { if (visible()) syncNow(); }, delay);
    }
    function queue(delay = debounceMs) {
      cancel(debounceTimer);
      if (!started || disposed || blocked) return;
      debounceTimer = schedule(() => syncNow(), delay);
    }
    function changed() {
      if (disposed) return;
      actual();
      if (blocked) return;
      status(online() ? 'pending' : 'offline', online() ? 'Değişiklikler eşitlenecek' : 'Çevrim dışı · Değişiklikler cihazında kayıtlı', { error: null });
      if (busy) again = true;
      queue();
    }
    async function cycle() {
      if (!online()) { status('offline', 'Çevrim dışı · Bağlantı gelince eşitlenecek', { error: null }); return; }
      status('syncing', 'Cihazların eşitleniyor', { error: null });
      try {
        backup();
        let response = (await request('GET')).data;
        if (!identity(response.user) || disposed) return;
        revision = response.revision;
        let cloud = response.notebook;
        let local = actual();
        if (!local && !cloud) {
          failures = 0;
          status('ready', 'Bulut bağlantısı hazır · Örnek defter eşitlenmez', { lastSyncedAt: now(), error: null });
          return;
        }
        let wrote = false;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (disposed || blocked) return;
          local = actual();
          const merged = mergeNotebooks(local, cloud);
          apply(merged, 'cloud');
          if (cloud && stable(normalizeNotebook(cloud)) === stable(merged)) {
            failures = 0;
            cancel(retryTimer);
            status('synced', 'Kayıtların bulutla güncel', { lastSyncedAt: now(), error: null });
            if (wrote) channel?.postMessage({ type: 'synced', device, owner: currentUser.id });
            return;
          }
          backup();
          const saved = await request('PUT', { baseRevision: revision, notebook: merged });
          if (!identity(saved.data.user) || disposed) return;
          revision = saved.data.revision;
          cloud = saved.data.notebook;
          if (!saved.conflict) wrote = true;
          // Re-read local state after every await: a word may have been added while saving.
        }
        throw new Error('Diğer cihazlarda değişiklik yapılıyor. Kayıtların korunuyor; eşitleme yeniden denenecek.');
      } catch (error) {
        if (disposed) return;
        if (error.authentication) status('login-required', error.message, { error: error.message });
        else if (error.unsupported) status('local', error.message, { error: null });
        else {
          const label = !online() ? 'Çevrim dışı · Bağlantı gelince eşitlenecek' : error.name === 'AbortError' ? 'Bulut bağlantısı zaman aşımına uğradı. Yeniden denenecek.' : error.message;
          status(!online() ? 'offline' : 'error', label, { error: label });
          if (!error.localBackup) retry();
        }
      }
    }
    function syncNow() {
      cancel(debounceTimer);
      if (disposed || blocked || !started) return Promise.resolve({ ...state });
      if (busy) { again = true; return busy; }
      busy = (async () => {
        do { again = false; await cycle(); } while (again && !disposed && !blocked && online());
        return { ...state };
      })().finally(() => { busy = null; });
      return busy;
    }
    function focus() { if (visible()) queue(50); }
    function onOnline() { failures = 0; cancel(retryTimer); queue(0); }
    function onOffline() { status('offline', 'Çevrim dışı · Bağlantı gelince eşitlenecek', { error: null }); }
    function storageChanged(event) {
      if (disposed || blocked || event.key !== NOTEBOOK_KEY || !event.newValue) return;
      try {
        const sibling = JSON.parse(event.newValue);
        if (sibling.demo === true) return;
        if (currentUser && read(OWNER_KEY) && read(OWNER_KEY) !== currentUser.id) return;
        const local = actual();
        apply(mergeNotebooks(local, sibling), 'tab');
        queue(50);
      } catch {}
    }
    function start() {
      if (started || disposed) return busy || Promise.resolve({ ...state });
      started = true;
      eventTarget?.addEventListener?.('online', onOnline);
      eventTarget?.addEventListener?.('offline', onOffline);
      eventTarget?.addEventListener?.('focus', focus);
      eventTarget?.addEventListener?.('storage', storageChanged);
      doc?.addEventListener?.('visibilitychange', focus);
      const Broadcast = options.BroadcastChannel === undefined ? root.BroadcastChannel : options.BroadcastChannel;
      if (Broadcast) {
        try {
          channel = new Broadcast('kelime-notebook-sync-v1');
          channel.onmessage = ({ data }) => { if (data?.type === 'synced' && data.device !== device && (!currentUser || data.owner === currentUser.id)) queue(50); };
        } catch {}
      }
      function poll() {
        if (disposed) return;
        if (visible()) syncNow();
        pollTimer = schedule(poll, pollMs);
      }
      if (pollMs > 0) pollTimer = schedule(poll, pollMs);
      return syncNow();
    }
    function dispose() {
      disposed = true;
      cancel(debounceTimer); cancel(retryTimer); cancel(pollTimer);
      controller?.abort(); channel?.close();
      eventTarget?.removeEventListener?.('online', onOnline);
      eventTarget?.removeEventListener?.('offline', onOffline);
      eventTarget?.removeEventListener?.('focus', focus);
      eventTarget?.removeEventListener?.('storage', storageChanged);
      doc?.removeEventListener?.('visibilitychange', focus);
    }
    return { start, changed, syncNow, dispose, getStatus: () => ({ ...state }) };
  }
  const api = { create, normalizeNotebook, mergeNotebooks, stampChanges, wordKey, stable };
  root.KelimeSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
