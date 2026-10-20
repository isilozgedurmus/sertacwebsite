import { createHash, timingSafeEqual } from 'node:crypto';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import worker from '../dist/server/index.js';
import { createNotebookStore, MAX_NOTEBOOK_BYTES } from './notebook-store.mjs';

const safeHeaders = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Authorization' };
const response = (statusCode, value, headers = {}) => ({ statusCode, headers: { ...safeHeaders, ...headers }, body: typeof value === 'string' ? value : JSON.stringify(value), isBase64Encoded: false });
const json = (status, value) => response(status, value, { 'Content-Type': 'application/json; charset=utf-8' });
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export function createLambdaHandler({ store, credentials, serve = worker.fetch, publicOrigin = '' }) {
  return async event => {
    try {
      const headers = new Headers(event.headers || {});
      const method = event.requestContext?.http?.method || 'GET';
      const hostname = event.requestContext?.domainName;
      if (!hostname || !/^[a-z0-9.-]+$/i.test(hostname)) return json(400, { error: 'Geçersiz istek.' });
      const origin = 'https://' + hostname;
      const path = event.rawPath || '/';
      if (path === '/health' && method === 'GET') return json(200, { status: 'ok' });
      const secret = await credentials();
      if (typeof secret.username !== 'string' || typeof secret.password !== 'string' || secret.password.length < 16) return json(503, { error: 'Uygulama giriş ayarı tamamlanmamış.' });
      const authorization = headers.get('authorization') || '';
      let supplied = '';
      if (/^Basic [A-Za-z0-9+/=]+$/i.test(authorization)) supplied = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      if (!equal(supplied, secret.username + ':' + secret.password)) {
        return response(401, 'Kelime defterine erişmek için uygulama kullanıcı adını ve şifreni gir.', { 'Content-Type': 'text/plain; charset=utf-8', 'WWW-Authenticate': 'Basic realm="Kelime", charset="UTF-8"' });
      }
      const user = { id: 'aws-personal-owner-v1', email: secret.username };
      if (path === '/api/sync') {
        if (method === 'GET') return json(200, await store.get(user));
        if (method !== 'PUT') return json(405, { error: 'Desteklenmeyen işlem.' });
        const requestOrigin = headers.get('origin');
        if (requestOrigin && ![origin, publicOrigin].filter(Boolean).includes(requestOrigin) || headers.get('sec-fetch-site') === 'cross-site') return json(403, { error: 'İstek kaynağı geçersiz.' });
        if (headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json(415, { error: 'JSON istek gerekli.' });
        const bodyText = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
        if (Buffer.byteLength(bodyText) > MAX_NOTEBOOK_BYTES) return json(413, { error: 'Defter bu eşitleme için çok büyük.' });
        let body;
        try { body = JSON.parse(bodyText); } catch { return json(400, { error: 'Geçersiz JSON.' }); }
        if (!Number.isSafeInteger(body?.baseRevision) || body.baseRevision < 0) return json(400, { error: 'Eşitleme sürümü geçersiz.' });
        try { const saved = await store.save(user, body.baseRevision, body.notebook); return json(saved.status, saved.data); }
        catch (error) { if (error.name === 'NotebookValidationError') return json(400, { error: error.message }); throw error; }
      }
      if (path.startsWith('/api/')) return json(404, { error: 'İşlem bulunamadı.' });
      // Never trust browser-supplied Sites identity headers on a different host.
      headers.delete('oai-authenticated-user-id'); headers.delete('oai-authenticated-user-email'); headers.delete('authorization');
      const result = await serve(new Request(origin + path + (event.rawQueryString ? '?' + event.rawQueryString : ''), { method, headers }), {});
      return response(result.status, method === 'HEAD' ? '' : await result.text(), { ...Object.fromEntries(result.headers), ...safeHeaders });
    } catch { return json(503, { error: 'Hizmete şu anda ulaşılamıyor. Cihazdaki kayıtların korunuyor.' }); }
  };
}

const s3 = new S3Client({}), secrets = new SecretsManagerClient({});
let cachedCredentials;
const credentials = async () => {
  if (cachedCredentials?.expires > Date.now()) return cachedCredentials.value;
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.AUTH_SECRET_ARN }));
  const value = JSON.parse(result.SecretString);
  cachedCredentials = { value, expires: Date.now() + 60000 }; return value;
};
const store = createNotebookStore({
  async read() {
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: process.env.NOTEBOOK_BUCKET, Key: 'owner/notebook.json' }));
      if (result.ContentLength > MAX_NOTEBOOK_BYTES) throw Error('Notebook too large');
      return { state: JSON.parse(await result.Body.transformToString()), etag: result.ETag };
    } catch (error) { if (error.name === 'NoSuchKey') return { state: null, etag: null }; throw error; }
  },
  async write(state, etag) {
    await s3.send(new PutObjectCommand({ Bucket: process.env.NOTEBOOK_BUCKET, Key: 'owner/notebook.json', Body: JSON.stringify(state),
      ContentType: 'application/json', ServerSideEncryption: 'AES256', ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }) }));
  },
});
export const handler = createLambdaHandler({ store, credentials, publicOrigin: process.env.PUBLIC_ORIGIN || '' });
