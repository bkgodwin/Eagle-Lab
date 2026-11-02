import http from 'node:http';
import https from 'node:https';
import { cookies, validGrant } from './security.mjs';
import { cookieBridgeSource } from './pve-cookie-bridge.mjs';
import { consoleBridgeSource } from './pve-console-bridge.mjs';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

// A distinct origin/port per node preserves PVE's absolute URLs and isolates storage.
// PVE cookies are additionally namespaced because cookies do not isolate by port.
export function createNodeProxy({ row, getRow, key, host, tls, portalPort, isAdmin }) {
  const cookieName = `PVEAuthCookie_${row.id.replaceAll('-', '')}`;
  const allowed = req => {
    const current = getRow(row.id);
    return current && (isAdmin(req) || validGrant(cookies(req)[`lab_node_${row.id}`], current, key));
  };
  function headers(req) {
    const cookie = (req.headers.cookie || '').split(';').map(c => c.trim()).filter(c => c.startsWith(`${cookieName}=`)).map(c => c.replace(cookieName, 'PVEAuthCookie')).join('; ');
    const h = { ...req.headers, host: `${getRow(row.id).ip}:8006`, 'accept-encoding': 'identity', cookie };
    delete h['proxy-authorization']; delete h.forwarded; delete h['x-forwarded-for'];
    if (h.origin) h.origin = `https://${getRow(row.id).ip}:8006`;
    if (h.referer) h.referer = `https://${getRow(row.id).ip}:8006/`;
    return h;
  }
  const options = req => ({ hostname: getRow(row.id).ip, port: 8006, path: req.url, method: req.method, headers: headers(req), rejectUnauthorized: !getRow(row.id).allow_self_signed });
  const ownOrigin = req => {
    try {
      const origin=`${tls ? 'https' : 'http'}://${req.headers.host}`;
      const parsed=new URL(origin);
      if(parsed.username||parsed.password||parsed.pathname!=='/') return false;
      return !req.headers.origin || req.headers.origin===origin;
    } catch { return false; }
  };
  const handler = (req, res) => {
    if (!ownOrigin(req)||!allowed(req)) { res.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('Unlock this server in the lab portal, then reconnect.'); }
    if (req.url.split('?')[0] === '/_eagle/cookie-bridge.js') {
      res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(cookieBridgeSource(cookieName,!!tls)+'\n'+consoleBridgeSource());
    }
    const upstream = https.request(options(req), incoming => {
      const h = { ...incoming.headers };
      delete h['x-frame-options']; delete h['content-security-policy']; delete h['content-security-policy-report-only'];
      // Same hostname, portal port only. No general-purpose iframe bypass.
      const portal = `${tls ? 'https' : 'http'}://${new URL(`${tls ? 'https' : 'http'}://${req.headers.host}`).hostname}:${portalPort}`;
      h['content-security-policy'] = `frame-ancestors ${portal} 'self'`;
      h['permissions-policy'] = 'clipboard-read=(*), clipboard-write=(*)';
      // HTML/JS must pick up compatibility changes immediately after a portal update.
      h['cache-control'] = /\.(?:css|woff2?|ttf|svg|png|ico)(?:\?|$)/i.test(req.url) ? 'private, max-age=3600' : 'no-store';
      if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].map(c => c.replaceAll('PVEAuthCookie', cookieName).replace(/;\s*domain=[^;]+/ig, '').replace(!tls ? /;\s*secure/ig : /$^/, ''));
      if (h.location?.startsWith(`https://${getRow(row.id).ip}:8006`)) h.location = h.location.replace(`https://${getRow(row.id).ip}:8006`, `${tls ? 'https' : 'http'}://${req.headers.host}`);
      const type = h['content-type'] || '';
      if (/javascript|text\/html/.test(type)) {
        // The UI reads and writes this cookie in JS; namespace those references too.
        delete h['content-length']; delete h.etag; delete h['content-encoding'];
        const chunks = []; let size = 0;
        incoming.on('data', chunk => { size += chunk.length; if (size > 32 * 1024 * 1024) incoming.destroy(); else chunks.push(chunk); });
        incoming.on('end', () => {
          try {
            let data=Buffer.concat(chunks);
            const encoding=(incoming.headers['content-encoding'] || 'identity').toLowerCase();
            const decode={gzip:gunzipSync,deflate:inflateSync,br:brotliDecompressSync}[encoding];
            if (decode) data=decode(data,{maxOutputLength:32*1024*1024});
            else if (encoding!=='identity') throw new Error('Unsupported upstream encoding');
            let text=data.toString('utf8').replaceAll('PVEAuthCookie',cookieName);
            if (/text\/html/.test(type)) {
              const bridge='<script src="/_eagle/cookie-bridge.js"></script>';
              text=/<head\b[^>]*>/i.test(text) ? text.replace(/<head\b[^>]*>/i,head=>head+bridge) : bridge+text;
            }
            res.writeHead(incoming.statusCode,h);res.end(text);
          } catch { res.writeHead(502,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Could not prepare the PVE management interface.'); }
        });
        incoming.on('error', () => res.destroy());
      } else { res.writeHead(incoming.statusCode, h); incoming.pipe(res); }
    });
    upstream.setTimeout(30000, () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('PVE is unavailable. Check its status and network connection.'); });
    req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const closeConnections = server.closeAllConnections.bind(server);
  server.closeAllConnections = () => { closeConnections(); for (const socket of sockets) socket.destroy(); };
  server.on('upgrade', (req, socket, head) => {
    if (!ownOrigin(req)||!allowed(req)) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    const up = https.request(options(req));
    up.setTimeout(15000, () => up.destroy());
    up.on('upgrade', (response, remote, upstreamHead) => {
      up.setTimeout(0);
      remote.setTimeout(0);socket.setTimeout(0);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).filter(([k]) => !['set-cookie'].includes(k)).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) remote.write(head);
      remote.pipe(socket); socket.pipe(remote);
      socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
      socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy());
    });
    up.on('response', response => { response.resume();const code=response.statusCode || 502;socket.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code] || 'Upstream Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); });
    up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy()); up.end();
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(row.proxy_port, host, () => resolve(server)); });
}
