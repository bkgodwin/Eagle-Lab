import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export const random = () => randomBytes(32).toString('hex');
export function hash(value) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}
export function verify(value, stored) {
  try {
    const [salt, expected] = stored.split(':');
    return timingSafeEqual(scryptSync(value, salt, 64), Buffer.from(expected, 'hex'));
  } catch { return false; }
}
export function seal(value, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
export function unseal(value, key) {
  const buf = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  cipher.setAuthTag(buf.subarray(-16));
  return Buffer.concat([cipher.update(buf.subarray(12, -16)), cipher.final()]).toString();
}
export const sign = (value, key) => createHmac('sha256', key).update(value).digest('hex');
export function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split(/=(.*)/s)).filter(v => v.length > 1).map(([k,v]) => [k,v]));
}
export function validAddress(value) {
  // Only administrator-enrolled private IPv4 addresses can become proxy targets.
  if (isIP(value) !== 4) return false;
  const [a,b] = value.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export function grantToken(row, key, expiry = Date.now() + 8 * 3600000) {
  const value = `${row.id}.${row.revision}.${expiry}`;
  return `${value}.${sign(value, key)}`;
}
export function validGrant(token, row, key) {
  if (!token) return false;
  const parts=token.split('.');
  if(parts.length!==4) return false;
  const [id, rev, exp, sig] = parts;
  if (id !== row.id || +rev !== row.revision || !Number.isFinite(+exp) || +exp < Date.now()) return false;
  const expected = sign(`${id}.${rev}.${exp}`, key);
  return !!sig && sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
export class Limiter {
  constructor() { this.entries = new Map(); }
  check(key, max = 10, interval = 60000) {
    const now = Date.now();
    if (this.entries.size > 10000) for (const [k,v] of this.entries) if (v.until < now) this.entries.delete(k);
    let entry = this.entries.get(key);
    if (!entry || entry.until < now) this.entries.set(key, entry = { count: 0, until: now + interval });
    return ++entry.count <= max;
  }
}
