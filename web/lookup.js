/* Read-only public dictionaries. No API keys or user account data are sent. */
(function (root) {
  'use strict';
  const CACHE_KEY = 'kelime-lookup-cache-v4';
  const TTL = 30 * 24 * 60 * 60 * 1000;
  const normalize = word => String(word || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const validWord = word => /^[a-z]+(?:[ '\u2019-][a-z]+)*$/i.test(word) && word.length <= 80;
  const unique = values => [...new Set(values.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))];
  // Original learner notes: common pronouns must not resolve to rare verb senses.
  // These small, reviewed entries take precedence over machine translations and cache.
  const PRONOUNS = {
    i: ['ben', 'I read a little every day.', 'The speaker, used as the subject.'],
    you: ['sen; siz', 'You can join us tomorrow.', 'The person or people being addressed.'],
    he: ['o (erkek kişi)', 'He is waiting outside.', 'A male person, used as the subject.'],
    she: ['o (kadın kişi)', 'She enjoys reading.', 'A female person, used as the subject.'],
    it: ['o (nesne, hayvan veya durum)', 'It is on the table.', 'A thing, animal or situation already identified.'],
    we: ['biz', 'We study together.', 'The speaker and at least one other person.'],
    they: ['onlar; tek bir kişi için bağlama göre o', 'They study English together.', 'A group already identified; also one person when their gender is unknown or when they use this pronoun.'],
    me: ['beni; bana', 'Please help me.', 'The speaker, used as the object.'],
    him: ['onu; ona (erkek kişi)', 'I gave him a book.', 'A male person, used as the object.'],
    her: ['onu; ona (kadın kişi); iyelikte onun', 'I spoke to her yesterday.', 'A female person as the object; also a possessive determiner before a noun.'],
    us: ['bizi; bize', 'Can you help us?', 'The speaker and other people, used as the object.'],
    them: ['onları; onlara; tek kişi için onu veya ona', 'I sent them a message.', 'The object form corresponding to they.'],
  };
  const typeLabel = type => ({ pronoun: 'Zamir · pronoun', noun: 'İsim · noun', verb: 'Fiil · verb', adjective: 'Sıfat · adjective', adverb: 'Zarf · adverb', preposition: 'Edat · preposition', conjunction: 'Bağlaç · conjunction', determiner: 'Belirleyici · determiner', interjection: 'Ünlem · interjection', phrase: 'İfade · phrase' }[type] || type || '');
  let cache = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    if (Array.isArray(saved)) cache = new Map(saved.filter(x => Array.isArray(x) && x[1]?.savedAt > Date.now() - TTL));
  } catch {}

  async function requestJSON(url, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 14000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw Object.assign(new Error('Sözlük hizmetine ulaşılamadı.'), { status: response.status });
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  function parseDictionary(entries, word = '') {
    const candidates = (Array.isArray(entries) ? entries : [])
      .filter(e => (!word || normalize(e.word) === word) && Array.isArray(e.meanings))
      .flatMap(entry => entry.meanings.flatMap(meaning => (meaning.definitions || [])
        .filter(d => typeof d.definition === 'string' && d.definition.trim())
        .map(definition => ({ entry, meaning, definition }))));
    if (!candidates.length) return null;
    const uncommon = d => /^\([^)]*\b(archaic|obsolete|rare|dated|historical|nonstandard|slang)\b[^)]*\)/i.test(d.definition);
    const { entry, meaning, definition } = candidates.find(c => !uncommon(c.definition)) || candidates[0];
    // Relations attached to a different definition may describe a different sense.
    const synonyms = unique([...(definition.synonyms || []), ...(meaning.definitions.length === 1 ? meaning.synonyms || [] : [])]);
    const antonyms = unique([...(definition.antonyms || []), ...(meaning.definitions.length === 1 ? meaning.antonyms || [] : [])]);
    return {
      type: meaning.partOfSpeech || '',
      definition: definition.definition || '',
      example: definition.example || '',
      synonym: synonyms.slice(0, 1).join(', '),
      antonym: antonyms.slice(0, 1).join(', '),
      sourceUrl: entry.sourceUrls?.find(u => typeof u === 'string' && u.startsWith('https://en.wiktionary.org/')) || '',
      license: entry.license?.name || 'CC BY-SA 3.0',
      multipleMeanings: candidates.length > 1,
    };
  }

  function validTranslation(value, word) {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    // A dictionary gloss must contain words, not counts, markup, URLs or service messages.
    return !!text && text.length <= 200 && normalize(text) !== normalize(word)
      && /[a-zçğıöşüâîû]/i.test(text) && !/[0-9<>\u0000-\u001f]/.test(text)
      && !/https?:|www\.|MYMEMORY WARNING|QUERY LENGTH|INVALID LANGUAGE|LIMIT EXCEEDED|TRANSLATED BY|SERVICE UNAVAILABLE/i.test(text)
      && !/[^\p{Script=Latin}\p{M}\p{P}\p{Zs}]/u.test(text);
  }

  function parseTranslation(payload, word) {
    if (Number(payload?.responseStatus) !== 200 || payload?.quotaFinished) return '';
    if (Array.isArray(payload.matches)) {
      // Match scores alone are insufficient: the actual "reaching" response gave
      // a number a score of .97 and the correct translation a score of .85.
      const matches = payload.matches.filter(match => normalize(match.segment) === normalize(word)
        && /^en(?:[-_]|$)/i.test(match.source || '') && /^tr(?:[-_]|$)/i.test(match.target || '')
        && Number(match.match) >= .8 && Number(match.quality) >= 60
        && validTranslation(match.translation, word));
      matches.sort((a, b) => Number(b.match) - Number(a.match) || Number(b.quality) - Number(a.quality));
      return matches[0]?.translation.trim() || '';
    }
    // Without the segment and language metadata the result cannot be checked.
    return '';
  }

  function ingCandidates(word) {
    if (!/^[a-z]{2,}ing$/.test(word)) return [];
    if (word.endsWith('ying')) return [word.slice(0, -4) + 'ie', word.slice(0, -3)];
    const stem = word.slice(0, -3);
    return unique([stem.replace(/([b-df-hj-np-tv-z])\1$/, '$1'), stem, stem + 'e']).filter(w => w.length >= 3);
  }

  function parseRelations(payload, type, word) {
    const pos = { noun: 'n', verb: 'v', adjective: 'adj', adverb: 'adv' }[type];
    if (!pos) return '';
    return unique((Array.isArray(payload) ? payload : [])
      .filter(x => !pos || !x.tags?.length || x.tags.includes(pos))
      .map(x => x.word).filter(w => normalize(w) !== normalize(word)))
      .slice(0, 1).join(', ');
  }

  function parseMetadata(payload, word, preferredType = '') {
    const entry = Array.isArray(payload) ? payload.find(item => normalize(item.word) === word) : null;
    if (!entry?.defs?.length) return null;
    const codes = { noun: 'n', verb: 'v', adjective: 'adj', adverb: 'adv' };
    const definitions = entry.defs.filter(d => typeof d === 'string');
    const preferred = preferredType ? definitions.find(d => d.startsWith(codes[preferredType] + '\t')) : definitions[0];
    if (!preferred) return null;
    const first = preferred.split('\t');
    return { type: { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' }[first[0]] || '', multipleMeanings: definitions.length > 1,
      definition: first.slice(1).join(' ').trim(), sourceUrl: 'https://en.wiktionary.org/wiki/' + encodeURIComponent(word), license: 'CC BY-SA' };
  }

  async function lookup(word, { signal, refresh = false } = {}) {
    word = normalize(word);
    if (!validWord(word)) throw new Error('İngilizce kelimeyi harflerle yaz.');
    if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
    if (Object.hasOwn(PRONOUNS, word)) {
      const [tr, example, definition] = PRONOUNS[word];
      return { word, tr, example, definition, type: 'pronoun', synonym: '', antonym: '', source: 'local',
        reviewed: true, verified: true, dictionaryStatus: 'found', translationStatus: 'found',
        synonymStatus: 'not-applicable', antonymStatus: 'not-applicable' };
    }
    const local = root.DEMO_WORDS?.find(w => normalize(w.word) === word);
    if (local) return { ...local, word, source: 'local', translationStatus: 'found', synonymStatus: local.synonym ? 'found' : 'none', antonymStatus: local.antonym ? 'found' : 'none' };
    const old = cache.get(word);
    if (!refresh && old && old.savedAt > Date.now() - TTL && old.data?.validationVersion === 1 && validTranslation(old.data.tr, word)) return { ...old.data, cached: true };

    const [dictionary, translation, metadata] = await Promise.allSettled([
      requestJSON('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word), signal),
      requestJSON('https://api.mymemory.translated.net/get?' + new URLSearchParams({ q: word, langpair: 'en|tr' }), signal),
      requestJSON('https://api.datamuse.com/words?' + new URLSearchParams({ sp: word, md: 'dp', max: '1' }), signal),
    ]);
    if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
    const parsed = (dictionary.status === 'fulfilled' ? parseDictionary(dictionary.value, word) : null)
      || (metadata.status === 'fulfilled' ? parseMetadata(metadata.value, word) : null);
    const tr = translation.status === 'fulfilled' ? parseTranslation(translation.value, word) : '';
    const result = { word, tr, type: '', synonym: '', antonym: '', example: '', definition: '', ...parsed,
      source: 'online', validationVersion: 1, dictionaryStatus: parsed ? 'found' : dictionary.reason?.status === 404 ? 'not-found' : 'unavailable',
      translationStatus: tr ? 'found' : 'unavailable', translationRejected: !tr && translation.status === 'fulfilled' && !!translation.value?.responseData?.translatedText,
      synonymStatus: 'none', antonymStatus: 'none', sources: ['Free Dictionary API', 'MyMemory'] };
    const stems = ingCandidates(word);
    if (stems.length && result.tr) {
      const bases = await Promise.allSettled(stems.map(stem => requestJSON('https://api.datamuse.com/words?' + new URLSearchParams({ sp: stem, md: 'dp', max: '1' }), signal)));
      if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
      const index = bases.findIndex((base, i) => base.status === 'fulfilled' && parseMetadata(base.value, stems[i], 'verb'));
      if (index >= 0) {
        const base = parseMetadata(bases[index].value, stems[index], 'verb');
        // Keep the entered word. Describe the verified base without pretending
        // that an isolated -ing form has only one grammatical use.
        result.lemma = stems[index]; result.form = '-ing';
        result.formTypes = unique(['verb', ...(result.type ? [result.type] : [])]);
        result.type = 'verb'; result.definition = base.definition; result.sourceUrl = base.sourceUrl; result.license = base.license;
        result.example = ''; result.synonym = ''; result.antonym = ''; result.dictionaryStatus = 'found';
      }
    }
    const relationWord = result.lemma || word;
    const relationNeedsContext = !!result.lemma || result.multipleMeanings === true;
    const relations = await Promise.allSettled(['synonym', 'antonym'].map(key => result[key] || relationNeedsContext || !['noun', 'verb', 'adjective', 'adverb'].includes(result.type) ? Promise.resolve(null)
      : requestJSON('https://api.datamuse.com/words?' + new URLSearchParams({ [key === 'synonym' ? 'rel_syn' : 'rel_ant']: relationWord, md: 'p', max: '8' }), signal)));
    if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
    ['synonym', 'antonym'].forEach((key, i) => {
      if (!result[key] && relations[i].status === 'fulfilled') result[key] = parseRelations(relations[i].value, result.type, relationWord);
      result[key + 'Status'] = result[key] ? 'found' : relationNeedsContext ? 'context-required' : relations[i].status === 'rejected' || !parsed && result.dictionaryStatus === 'unavailable' ? 'unavailable' : 'none';
    });
    result.sources.push('Datamuse');
    // A failed dictionary check must never turn a random translation into a verified word.
    result.verified = !!parsed || !!result.lemma || !!result.synonym || !!result.antonym;
    if (!result.verified && result.dictionaryStatus === 'not-found') {
      result.tr = '';
      result.translationStatus = 'unavailable';
    }
    if (result.tr && result.verified) {
      cache.set(word, { savedAt: Date.now(), data: result });
      try { localStorage.setItem(CACHE_KEY, JSON.stringify([...cache].slice(-400))); } catch {}
    }
    return result;
  }
  root.KelimeLookup = { lookup, normalize, validWord, typeLabel, validTranslation, ingCandidates, parseDictionary, parseTranslation, parseRelations, parseMetadata };
})(window);
