const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../web/lookup.js'), 'utf8');
function create(fetch, saved = []) {
  const stored = new Map(saved);
  const context = { window: {}, localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) }, fetch, AbortController, DOMException, URLSearchParams, setTimeout, clearTimeout, Date };
  vm.createContext(context); vm.runInContext(source, context);
  return context.window.KelimeLookup;
}
const dictionary = [{ word: 'generous', meanings: [{ partOfSpeech: 'adjective', synonyms: [], antonyms: [], definitions: [{ definition: 'Willing to give and share.', example: 'She is generous with her time.' }] }], license: { name: 'CC BY-SA 3.0' }, sourceUrls: ['https://en.wiktionary.org/wiki/generous'] }];
const translation = { responseStatus: 200, quotaFinished: false, responseData: { translatedText: 'cömert' }, matches: [{ segment: 'generous', translation: 'cömert', source: 'en-GB', target: 'tr-TR', quality: 74, match: 1 }] };
const ok = value => ({ ok: true, json: async () => value });
async function main() {
  let requests = 0;
  const service = create(async url => {
    requests++;
    if (url.includes('dictionaryapi')) return ok(dictionary);
    if (url.includes('mymemory')) return ok(translation);
    if (url.includes('rel_syn')) return ok([{ word: 'benevolent', tags: ['adj'] }, { word: 'giving', tags: ['n'] }]);
    if (url.includes('rel_ant')) return ok([{ word: 'stingy', tags: ['adj'] }]);
    return ok([]);
  });
  const result = await service.lookup('  Generous  ');
  assert.equal(result.word, 'generous'); assert.equal(result.tr, 'cömert'); assert.equal(result.synonym, 'benevolent'); assert.equal(result.antonym, 'stingy'); assert.equal(result.type, 'adjective');
  const oldRequests = requests; assert.equal((await service.lookup('generous')).cached, true); assert.equal(requests, oldRequests);
  assert.equal(service.parseTranslation({ ...translation, quotaFinished: true }, 'generous'), '');
  assert.equal(service.parseTranslation({ ...translation, responseStatus: 429 }, 'generous'), '');
  assert.equal(service.parseTranslation({ ...translation, matches: [{ ...translation.matches[0], translation: 'generous' }] }, 'generous'), '');
  const reachingPayload = { responseStatus: 200, responseData: { translatedText: '1.702.217', match: .97 }, matches: [
    { segment: 'Reaching', translation: '1.702.217', source: 'en-GB', target: 'tr-TR', quality: 74, match: .97 },
    { segment: 'reaching', translation: 'ulaşmak', source: 'en-GB', target: 'tr-TR', quality: 70, match: .85 },
    { segment: 'Beam reaching', translation: 'Yelkende apazına seyir', source: 'en-GB', target: 'tr-TR', quality: 74, match: .85 },
  ] };
  assert.equal(service.parseTranslation(reachingPayload, 'reaching'), 'ulaşmak', 'Use the valid exact-word alternative, not the top-scored number.');
  for (const invalid of ['1.702.217', '42', 'word 999', '<b>çeviri</b>', 'https://example.com', 'перевод', 'QUERY LENGTH LIMIT EXCEEDED', 'reaching']) {
    assert.equal(service.validTranslation(invalid, 'reaching'), false, 'Reject invalid translation: ' + invalid);
  }
  for (const mismatch of [
    { segment: 'Beam reaching' }, { source: 'de-DE' }, { target: 'es-ES' }, { quality: 30 }, { match: .4 },
  ]) assert.equal(service.parseTranslation({ ...translation, matches: [{ ...translation.matches[0], ...mismatch }] }, 'generous'), '');
  assert.equal(service.parseTranslation({ ...translation, matches: [] }, 'generous'), '');
  assert.equal(service.parseTranslation({ responseStatus: 200, responseData: { translatedText: 'cömert' } }, 'generous'), '', 'Unchecked response text is not a translation fallback.');
  const rootMetadata = word => [{ word, defs: ['n\tAn unrelated noun.', 'v\tTo extend an arm or arrive somewhere.'] }];
  const reachingService = create(async url => {
    const parsedURL = new URL(url);
    if (url.includes('dictionaryapi')) return ok([{ word: 'reaching', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'The action of one who reaches.' }] }] }]);
    if (url.includes('mymemory')) return ok(reachingPayload);
    if (parsedURL.searchParams.get('sp') === 'reach') return ok(rootMetadata('reach'));
    if (parsedURL.searchParams.has('rel_syn')) return ok([{ word: 'reach', tags: ['v'] }, { word: 'extend', tags: ['v'] }]);
    return ok([]);
  });
  const reaching = await reachingService.lookup('reaching');
  assert.equal(reaching.word, 'reaching'); assert.equal(reaching.tr, 'ulaşmak');
  assert.equal(reaching.lemma, 'reach'); assert.equal(reaching.type, 'verb'); assert.equal(reaching.synonym, ''); assert.equal(reaching.synonymStatus, 'context-required', 'Do not borrow an arbitrary synonym from another root-word sense.');
  assert.ok(reaching.formTypes.includes('noun'), 'Retain the possible noun use instead of treating the form as unambiguous.');
  assert.equal(service.parseMetadata(rootMetadata('reach'), 'reach', 'verb').type, 'verb');
  assert.equal(service.parseMetadata([{ word: 'reach', defs: ['n\tA range.'] }], 'reach', 'verb'), null);
  for (const [form, base] of [['reaching', 'reach'], ['running', 'run'], ['making', 'make'], ['lying', 'lie']]) assert.ok(service.ingCandidates(form).includes(base));
  assert.equal(service.ingCandidates('sing').length, 0);
  const onlyBad = create(async url => url.includes('dictionaryapi') ? ok(dictionary) : url.includes('mymemory') ? ok({ ...reachingPayload, matches: [reachingPayload.matches[0]] }) : ok([]));
  const rejected = await onlyBad.lookup('generous'); assert.equal(rejected.tr, ''); assert.equal(rejected.translationRejected, true);
  assert.equal(service.parseMetadata([{ word: 'wrong', defs: ['n\ta thing'] }], 'generous'), null);
  assert.equal(service.parseMetadata([{ word: 'generous', defs: ['adj\tWilling to share'] }], 'generous').type, 'adjective');
  const badCache = JSON.stringify([['they', { savedAt: Date.now(), data: { word: 'they', tr: 'de', type: 'verb' } }]]);
  let pronounRequests = 0;
  const pronouns = create(async () => { pronounRequests++; throw Error('Basic pronouns must work offline.'); }, [['kelime-lookup-cache-v2', badCache], ['kelime-lookup-cache-v3', badCache]]);
  for (const name of ['they', 'i', 'you', 'he', 'she', 'it', 'we', 'me', 'him', 'her', 'us', 'them']) {
    const basic = await pronouns.lookup(name);
    assert.equal(basic.type, 'pronoun'); assert.equal(basic.reviewed, true);
    assert.equal(basic.synonym, ''); assert.equal(basic.antonym, ''); assert.ok(basic.example);
    assert.equal(basic.synonymStatus, 'not-applicable');
  }
  assert.match((await pronouns.lookup(' THEY ')).tr, /^onlar/);
  assert.equal(pronounRequests, 0, 'Wrong cached or remote pronoun senses cannot override reviewed entries.');
  assert.equal(service.parseRelations([{ word: 'say', tags: ['v'] }], 'pronoun', 'they'), '');
  const senses = [{ word: 'sample', meanings: [{ partOfSpeech: 'noun', synonyms: ['wrong-sense'], definitions: [
    { definition: '(archaic) A disused meaning.', example: 'Old example.' },
    { definition: 'A small part used for examination.' },
    { definition: 'Another sense.', example: 'Unrelated example.' },
  ] }] }];
  const selected = service.parseDictionary(senses, 'sample');
  assert.equal(selected.definition, 'A small part used for examination.');
  assert.equal(selected.example, '', 'Never borrow an example from another sense.');
  assert.equal(selected.synonym, '', 'Never borrow relations from another sense.');
  assert.equal(selected.multipleMeanings, true);
  assert.equal(service.parseDictionary(senses, 'different'), null, 'Ignore entries for another spelling.');
  assert.equal(service.typeLabel('pronoun'), 'Zamir · pronoun');
  assert.equal(service.validWord('look forward to'), true); assert.equal(service.validWord('hello<script>'), false); assert.equal(service.validWord('123'), false);
  const failed = create(async () => { throw new Error('offline'); });
  const unavailable = await failed.lookup('unfamiliar');
  assert.equal(unavailable.tr, ''); assert.equal(unavailable.synonymStatus, 'unavailable'); assert.equal(unavailable.antonymStatus, 'unavailable'); assert.equal(unavailable.verified, false);
  const unknown = create(async url => url.includes('dictionaryapi') ? { ok: false, status: 404 } : url.includes('mymemory') ? ok({ ...translation, responseData: { translatedText: 'rastgele çeviri' } }) : ok([]));
  const miss = await unknown.lookup('qzxzz'); assert.equal(miss.dictionaryStatus, 'not-found'); assert.equal(miss.verified, false); assert.equal(miss.tr, '');
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(service.lookup('another', { signal: aborted.signal }), error => error.name === 'AbortError');
  console.log('PASS: real word shape, relation/POS filtering, cache, quota/error handling, exact metadata match, validation and cancellation.');
  if (process.argv.includes('--live')) {
    const live = create(globalThis.fetch);
    const word = await live.lookup('generous');
    assert.match(word.tr.toLowerCase(), /cömert/); assert.equal(word.type, 'adjective');
    if (word.antonym) assert.match(word.antonym, /stingy|ungenerous|meanspirited/);
    console.log('LIVE PASS:', JSON.stringify({ word: word.word, tr: word.tr, synonym: word.synonym, antonym: word.antonym, type: word.type }));
    const reaching = await live.lookup('reaching');
    assert.match(reaching.tr, /ulaş|uzan/); assert.equal(reaching.lemma, 'reach'); assert.equal(reaching.type, 'verb');
    console.log('LIVE PASS:', JSON.stringify({ word: reaching.word, tr: reaching.tr, lemma: reaching.lemma, type: reaching.type, formTypes: reaching.formTypes }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
