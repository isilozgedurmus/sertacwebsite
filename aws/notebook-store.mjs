import { validateNotebook } from '../dist/server/index.js';

export const MAX_NOTEBOOK_BYTES = 3_500_000;
export function mergeRecords(previous, incoming) {
  const merged = new Map();
  for (const record of [...previous, ...incoming]) {
    const key = record.kind + ':' + record.key, prior = merged.get(key);
    if (!prior || record.at > prior.at || record.at === prior.at && (record.by > prior.by || record.by === prior.by &&
      (!record.by && record.payload.length !== prior.payload.length ? record.payload.length > prior.payload.length : record.payload > prior.payload))) merged.set(key, record);
  }
  return [...merged.values()];
}

export function publicNotebook(state, user) {
  if (!state) return { revision: 0, notebook: null, user };
  const notebook = { demo: false, words: [], passages: [], sessions: [], notes: {}, _noteModified: {} };
  const arrays = { word: 'words', passage: 'passages', session: 'sessions' };
  for (const record of state.records) {
    const value = JSON.parse(record.payload);
    if (arrays[record.kind]) notebook[arrays[record.kind]].push(value);
    else if (record.kind === 'note') { notebook.notes[record.key] = value.data; notebook._noteModified[record.key] = value.modified; }
  }
  return { revision: state.revision, updatedAt: state.updatedAt, notebook, user };
}

// The object ETag is a compare-and-swap token. A rejected write cannot partially
// update a notebook, even when independent Lambda instances write concurrently.
export function createNotebookStore({ read, write }) {
  return {
    async get(user) { return publicNotebook((await read()).state, user); },
    async save(user, revision, notebook) {
      let incoming;
      try { incoming = validateNotebook(notebook); }
      catch (error) { error.name = 'NotebookValidationError'; throw error; }
      const current = await read();
      if (revision !== (current.state?.revision || 0)) return { status: 409, data: publicNotebook(current.state, user) };
      const state = { revision: revision + 1, updatedAt: Date.now(), records: mergeRecords(current.state?.records || [], incoming) };
      if (Buffer.byteLength(JSON.stringify(state)) > MAX_NOTEBOOK_BYTES) {
        return { status: 413, data: { error: 'Defter Lambda sürümünün 3,5 MB eşitleme sınırını aşıyor. Not görsellerini azaltıp tekrar deneyebilirsin.' } };
      }
      try { await write(state, current.etag); }
      catch (error) {
        if (![409, 412].includes(error.$metadata?.httpStatusCode)) throw error;
        return { status: 409, data: publicNotebook((await read()).state, user) };
      }
      return { status: 200, data: publicNotebook(state, user) };
    },
  };
}
