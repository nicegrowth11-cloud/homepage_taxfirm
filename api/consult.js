'use strict';
/**
 * 상담신청 접수 API (Vercel Serverless Function, 외부 의존성 없음)
 *
 *  - POST + application/json 만 허용, 본문 최대 8KB
 *  - Origin 검사(동일 호스트 또는 CONSULT_ALLOWED_ORIGINS)
 *  - consult-forms.json 기반 화이트리스트 검증(모르는 키 거부, 길이·패턴·선택지 검증, 제어문자 제거)
 *  - 허니팟(website) → 저장하지 않고 성공처럼 응답
 *  - 작성 시간 검사: GET 으로 발급한 토큰(CONSULT_TOKEN_SECRET 설정 시 HMAC 서명) 기준 3초~2시간
 *  - IP 기준 레이트 리밋(인스턴스 메모리, 10분 5회) — 보조 수단, 운영 시 Vercel WAF 규칙 권장
 *  - 저장: Firestore REST(서비스 계정은 서버 환경변수에만 존재). 미설정 시 503
 *  - 원본 IP·User-Agent 미저장, 응답에 입력값을 되돌려주지 않음
 */
const crypto = require('crypto');
const CONFIG = require('../consult-forms.json');

const MAX_BODY = 8 * 1024;
const MIN_FILL_MS = 3000;
const MAX_FILL_MS = 2 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = (!process.env.VERCEL && Number(process.env.CONSULT_TEST_RATE_MAX)) || 5; // 테스트 환경 외에는 항상 5
const COLLECTION = process.env.CONSULT_COLLECTION || 'consultation_requests';
const hits = new Map();

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;
const PHONE = /^0\d{1,2}-?\d{3,4}-?\d{4}$/;
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,180}\.[A-Za-z]{2,24}$/;

function send(res, status, body, extra) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (extra) for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  // Vercel은 x-real-ip / x-forwarded-for를 플랫폼에서 덮어써 위조를 막습니다. 로컬에서는 소켓 주소만 사용합니다.
  if (process.env.VERCEL) {
    const v = String(req.headers['x-real-ip'] || req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (v) return v;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimited(ip, now) {
  const key = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24);
  const list = (hits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) { hits.set(key, list); return true; }
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const k of hits.keys()) { hits.delete(k); if (hits.size < 2500) break; }
  return false;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const allowed = String(process.env.CONSULT_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  return host === String(req.headers['x-forwarded-host'] || req.headers.host || '');
}

function sign(ts) {
  const secret = process.env.CONSULT_TOKEN_SECRET;
  return secret ? crypto.createHmac('sha256', secret).update(String(ts)).digest('base64url') : null;
}
function issueToken() { const ts = Date.now(); const sig = sign(ts); return sig ? `${ts}.${sig}` : String(ts); }
function tokenAgeOk(token, now) {
  if (typeof token !== 'string' || token.length > 80) return false;
  const [tsStr, sig] = token.split('.');
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  const expected = sign(ts);
  if (expected) {
    if (!sig) return false;
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  }
  const age = now - ts;
  return age >= MIN_FILL_MS && age <= MAX_FILL_MS;
}

function clean(v) { return typeof v === 'string' ? v.replace(CONTROL, '').replace(/\r\n?/g, '\n').trim() : null; }

function checkInput(def, raw, errors) {
  const v = raw === undefined || raw === null ? '' : clean(raw);
  if (v === null) { errors.push(def.name); return undefined; }
  if (!v) { if (def.required) errors.push(def.name); return undefined; }
  if (def.type === 'select') { if (!def.options.includes(v)) errors.push(def.name); return v; }
  const len = [...v].length;
  if (len > (def.max || 100) || len < (def.min || 1)) { errors.push(def.name); return undefined; }
  if (def.type !== 'textarea' && (/[<>]/.test(v) || v.includes('\n'))) { errors.push(def.name); return undefined; }
  if (def.type === 'tel' && !PHONE.test(v)) { errors.push(def.name); return undefined; }
  if (def.type === 'email' && !EMAIL.test(v)) { errors.push(def.name); return undefined; }
  return v;
}

function validate(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: ['body'] };
  const field = CONFIG.fields.find((f) => f.key === body.field);
  if (!field) return { errors: ['field'] };
  const defs = [...field.inputs, ...CONFIG.common];
  const allowedKeys = new Set(['field', 'website', 'token', 'consent', ...defs.map((d) => d.name)]);
  for (const k of Object.keys(body)) if (!allowedKeys.has(k)) errors.push('unknown');
  const data = {};
  for (const def of defs) { const v = checkInput(def, body[def.name], errors); if (v !== undefined) data[def.name] = v; }
  if (body.consent !== true) errors.push('consent');
  return { errors, field, data };
}

/* ---------- Firestore (REST + 서비스 계정 JWT) ---------- */
let cachedToken = null;
function storageConfigured() { return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY); }
async function googleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: process.env.FIREBASE_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const key = String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n');
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = await r.json();
  cachedToken = { value: j.access_token, exp: now + (j.expires_in || 3600) };
  return cachedToken.value;
}
async function storeFirestore(record) {
  const token = await googleAccessToken();
  const fields = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === 'answers') fields.answers = { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([a, b]) => [a, { stringValue: b }])) } };
    else if (k === 'createdAt') fields.createdAt = { timestampValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: v };
  }
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(process.env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${encodeURIComponent(COLLECTION)}`;
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(`firestore ${r.status}`);
}

/* 로컬 테스트 전용 메모리 저장소 — Vercel 환경(VERCEL 변수 존재)에서는 활성화되지 않음 */
const testStore = [];
const testStoreEnabled = () => process.env.CONSULT_TEST_MEMORY === '1' && !process.env.VERCEL;

async function readBody(req) {
  const parsed = req.body;
  if (parsed !== undefined && parsed !== null && typeof parsed === 'object' && !Buffer.isBuffer(parsed)) {
    if (JSON.stringify(parsed).length > MAX_BODY) throw Object.assign(new Error('large'), { status: 413 });
    return parsed;
  }
  let raw = typeof parsed === 'string' || Buffer.isBuffer(parsed) ? String(parsed) : '';
  if (!raw && typeof req.on === 'function') {
    raw = await new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  if (Buffer.byteLength(raw) > MAX_BODY) throw Object.assign(new Error('large'), { status: 413 });
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('json'), { status: 400 }); }
}

async function handler(req, res) {
  if (req.method === 'GET') return send(res, 200, { token: issueToken() });
  if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'METHOD' }, { Allow: 'GET, POST' });
  if (!originAllowed(req)) return send(res, 403, { ok: false, code: 'ORIGIN' });
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return send(res, 415, { ok: false, code: 'TYPE' });
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) return send(res, 413, { ok: false, code: 'TOO_LARGE' });
  const now = Date.now();
  if (rateLimited(clientIp(req), now)) return send(res, 429, { ok: false, code: 'RATE' }, { 'Retry-After': '600' });

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, e.status === 413 ? 413 : 400, { ok: false, code: e.status === 413 ? 'TOO_LARGE' : 'BAD_REQUEST' }); }

  if (body && typeof body === 'object' && typeof body.website === 'string' && body.website.trim() !== '') return send(res, 200, { ok: true });
  if (!tokenAgeOk(body && body.token, now)) return send(res, 400, { ok: false, code: 'TIMING' });

  const { errors, field, data } = validate(body);
  if (errors.length) return send(res, 400, { ok: false, code: 'INVALID', fields: [...new Set(errors)].slice(0, 10) });

  const answers = {};
  for (const def of field.inputs) if (data[def.name] !== undefined) answers[def.name] = data[def.name];
  const record = {
    site: CONFIG.site, field: field.key, name: data.name, phone: data.phone, email: data.email || '', message: data.message || '',
    answers, consent: true, consentVersion: CONFIG.consentVersion, status: 'new', createdAt: new Date(now).toISOString(),
  };

  if (testStoreEnabled()) { testStore.push(record); return send(res, 200, { ok: true }); }
  if (!storageConfigured()) return send(res, 503, { ok: false, code: 'NOT_CONFIGURED' });
  try { await storeFirestore(record); } catch (e) { console.error('consult store failed:', e && e.message); return send(res, 502, { ok: false, code: 'STORE' }); }
  return send(res, 200, { ok: true });
}

module.exports = handler;
module.exports._test = { validate, testStore, tokenAgeOk, issueToken };
