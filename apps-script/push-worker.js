// 2nd Brain push sender — a Cloudflare Worker (free plan).
// Your Apps Script calls POST /send with { key, sub, payload }; this signs (VAPID) and encrypts (RFC 8291)
// the message and hands it to Apple/Google's push service. It stores nothing.
// Fill the three values below (your personal copy already has them).
const SEND_KEY = '';            // same value as PUSH_KEY in Code.gs
const VAPID_PUBLIC = '';        // base64url, 65-byte uncompressed P-256 point (also in the app)
const VAPID_PRIVATE_JWK = null; // { kty:'EC', crv:'P-256', x, y, d }
const VAPID_SUBJECT = 'https://devaughnwoodyard.github.io/life-board/';

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; a.forEach(x => { out.set(x, o); o += x.length; }); return out; };
async function hmac(key, data) { const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, data)); }

async function vapidJWT(endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', VAPID_PRIVATE_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return head + '.' + body + '.' + b64u(sig);
}

// RFC 8291 (aes128gcm) payload encryption
async function encrypt(sub, text) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, cat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

async function send(sub, payload) {
  const body = await encrypt(sub, typeof payload === 'string' ? payload : JSON.stringify(payload));
  const r = await fetch(sub.endpoint, { method: 'POST', body, headers: {
    TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    Authorization: 'vapid t=' + (await vapidJWT(sub.endpoint)) + ', k=' + VAPID_PUBLIC } });
  return { status: r.status, text: r.ok ? '' : (await r.text()).slice(0, 300) };
}

export default {
  async fetch(req) {
    if (req.method === 'GET') return new Response('2nd Brain push sender is running.', { headers: { 'content-type': 'text/plain' } });
    let b; try { b = await req.json(); } catch (e) { return Response.json({ ok: false, error: 'bad json' }, { status: 400 }); }
    if (!SEND_KEY || b.key !== SEND_KEY) return Response.json({ ok: false, error: 'bad key' }, { status: 403 });
    if (!b.sub || !b.sub.endpoint || !b.sub.keys) return Response.json({ ok: false, error: 'no subscription' }, { status: 400 });
    try { const r = await send(b.sub, b.payload || { title: '2nd Brain', body: 'Test' }); return Response.json({ ok: r.status < 300, ...r }); }
    catch (e) { return Response.json({ ok: false, error: String(e) }, { status: 500 }); }
  }
};
export { encrypt, vapidJWT };   // for tests
