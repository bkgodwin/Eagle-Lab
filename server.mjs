import http from 'node:http';
import https from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { hash, verify, seal, unseal, random, cookies, validAddress, grantToken, validGrant, Limiter } from './lib/security.mjs';
import { createNodeProxy } from './lib/proxy.mjs';
import { checkManagement } from './lib/status.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
if (process.platform !== 'win32') process.umask(0o077);
const DATA = resolve(process.env.DATA_DIR || join(ROOT, 'data'));
mkdirSync(DATA, { recursive: true });
const keyPath = join(DATA, 'secret.key');
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
const key = readFileSync(keyPath);
const PORT = Number(process.env.PORT || 3000), HOST = process.env.HOST || '0.0.0.0';
const PROXY_START = Number(process.env.PROXY_PORT_START || 8100), PROXY_END = Number(process.env.PROXY_PORT_END || 8199);
const INTERVAL = Math.max(2000, Number(process.env.STATUS_INTERVAL_MS || 5000));
const STATUS_TIMEOUT = Number(process.env.STATUS_TIMEOUT_MS || 5000);
for (const [name,value] of [['PORT',PORT],['PROXY_PORT_START',PROXY_START],['PROXY_PORT_END',PROXY_END]]) {
  if (!Number.isInteger(value)||value<1||value>65535) throw new Error(`${name} must be a port between 1 and 65535.`);
}
if (PROXY_START>PROXY_END) throw new Error('PROXY_PORT_START must not exceed PROXY_PORT_END.');
if (!Number.isFinite(INTERVAL)) throw new Error('STATUS_INTERVAL_MS must be a finite number.');
if (!Number.isFinite(STATUS_TIMEOUT)||STATUS_TIMEOUT<500||STATUS_TIMEOUT>60000) throw new Error('STATUS_TIMEOUT_MS must be between 500 and 60000.');
let publicUrl='';
if(process.env.PUBLIC_URL){
  const value=new URL(process.env.PUBLIC_URL);
  if(!['http:','https:'].includes(value.protocol)||value.username||value.password||value.pathname!=='/'||value.search||value.hash) throw new Error('PUBLIC_URL must be an HTTP(S) origin without credentials, query, or path.');
  publicUrl=value.origin+'/';
}
// Optional bootstrap token supports Docker/remote setup without trusting a forwarded client IP.
const tls = process.env.TLS_CERT && process.env.TLS_KEY ? { cert: readFileSync(process.env.TLS_CERT), key: readFileSync(process.env.TLS_KEY) } : null;
if (!!process.env.TLS_CERT !== !!process.env.TLS_KEY) throw new Error('Set both TLS_CERT and TLS_KEY.');
const db = new DatabaseSync(join(DATA, 'lab.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, hostname TEXT NOT NULL, ip TEXT NOT NULL UNIQUE, username TEXT NOT NULL DEFAULT 'root', password TEXT NOT NULL, pin_hash TEXT, notes TEXT NOT NULL DEFAULT '', proxy_port INTEGER NOT NULL UNIQUE, revision INTEGER NOT NULL DEFAULT 1, allow_self_signed INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id) ON DELETE SET NULL, server_name TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
const setting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const setSetting = (k,v) => db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,v);
if (setting('title') === 'PVE Lab') setSetting('title','Eagle-Lab');
const setupPath=join(DATA,'setup-token.txt');
let setupToken=process.env.SETUP_TOKEN || '';
if (!setting('admin_hash') && !setupToken && process.env.AUTO_SETUP === '1') {
  if (!existsSync(setupPath)) writeFileSync(setupPath,random(),{mode:0o600,flag:'wx'});
  setupToken=readFileSync(setupPath,'utf8').trim();
}
const setupTokenHash=setupToken ? hash(setupToken) : '';
const allRows = () => db.prepare('SELECT * FROM servers ORDER BY hostname COLLATE NOCASE').all();
const getRow = id => db.prepare('SELECT * FROM servers WHERE id=?').get(id);
const states = new Map(), sessions = new Map(), streams = new Set(), proxies = new Map(), proxyErrors = new Map(), limiter = new Limiter();
const cookieOptions = `; HttpOnly; SameSite=Strict${tls ? '; Secure' : ''}`;
const isAdmin = req => {
  const token = cookies(req).lab_admin, session = sessions.get(token);
  if (!session) return false;
  if (session.expires < Date.now()) { sessions.delete(token); return false; }
  return true;
};
const unlocked = (req,row) => isAdmin(req) || !row.pin_hash || validGrant(cookies(req)[`lab_node_${row.id}`], row, key);
const publicRow = row => ({ id: row.id, hostname: row.hostname, ip: row.ip, protected: !!row.pin_hash, ...states.get(row.id) || { status:'checking', checkedAt:null, latency:null } });
const adminRow = row => ({ ...publicRow(row), username:row.username, notes:row.notes, proxyPort:row.proxy_port, allowSelfSigned:!!row.allow_self_signed, proxyError:proxyErrors.get(row.id) || null });
const tasks = () => db.prepare('SELECT * FROM tasks ORDER BY position, rowid').all();
// Disconnect slow clients rather than accumulating an unbounded SSE write buffer.
const blockedStreams=new WeakSet();
const sendEvent = (res,payload) => {
  if (res.destroyed) return;
  if (res.writableLength>256*1024) { res.destroy(); return; }
  if (blockedStreams.has(res)) return;
  if (!res.write(payload)) { blockedStreams.add(res); res.once('drain',()=>blockedStreams.delete(res)); }
};
const publish = () => { const payload = `data: ${JSON.stringify(allRows().map(publicRow))}\n\n`; for (const res of streams) sendEvent(res,payload); };
function json(res, code, value, extra = {}) { res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...extra }); res.end(JSON.stringify(value)); }
function fail(code, message) { throw Object.assign(new Error(message), { status:code }); }
function textField(body, name, max, required = false) {
  if (typeof body[name] !== 'string') { if (required) fail(400, `${name} is required.`); return ''; }
  const value = body[name].trim();
  if (value.length > max || (required && !value)) fail(400, `${name} must be ${required ? '1–' : 'at most '}${max} characters.`);
  return value;
}
function secretField(body,name,min,max) {
  const value=body[name];
  if(typeof value!=='string'||value.length<min||value.length>max||!value.trim()) fail(400,`${name} must be ${min}–${max} characters.`);
  return value;
}
async function body(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>32768) fail(413,'Request is too large.'); chunks.push(chunk); }
  const data=Buffer.concat(chunks).toString('utf8');
  try { const value = JSON.parse(data || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw 0; return value; } catch { fail(400,'Invalid JSON.'); }
}
const local = req => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
async function startProxy(row) {
  if (proxies.has(row.id)) return;
  try { proxies.set(row.id, await createNodeProxy({row,getRow,key,host:HOST,tls,portalPort:PORT,isAdmin})); proxyErrors.delete(row.id); }
  catch (error) { proxyErrors.set(row.id, `Proxy port ${row.proxy_port} unavailable (${error.code || 'error'}).`); console.error(`Proxy ${row.hostname}: ${error.code || 'error'}`); }
}
function stopProxy(id) { const proxy = proxies.get(id); if (proxy) { proxy.closeAllConnections(); proxy.close(); proxies.delete(id); } proxyErrors.delete(id); }
async function probe(row) {
  const result=await checkManagement(row,STATUS_TIMEOUT);
  if (getRow(row.id)?.revision !== row.revision) return;
  states.set(row.id,result);
}
let probing = false;
async function probeAll() {
  if (probing) return; probing = true;
  try { const rows = allRows(); for (let i=0; i<rows.length; i+=12) await Promise.all(rows.slice(i,i+12).map(probe)); publish(); }
  finally { probing = false; }
}
const files = new Map(['index.html','app.js','style.css','reference.js','assets/datacenter.jpg'].map(name => [name, readFileSync(join(ROOT,'public',name))]));
const toolFiles=new Map(['index.html','app.js','style.css'].map(name=>[name,readFileSync(join(ROOT,'public','eagleide',name))]));
toolFiles.set('reference.js',files.get('reference.js'));
async function handle(req,res) {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Permissions-Policy','clipboard-read=(*), clipboard-write=(*)');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src ${tls ? 'https:' : 'http:'}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
  try {
    const url = new URL(req.url,'http://local'), path = url.pathname;
    if (['POST','PUT','DELETE','PATCH'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== `${tls ? 'https' : 'http'}://${req.headers.host}`) fail(403,'Request origin rejected.');
      if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'JSON content type required.');
    }
    // EagleIDE's restricted gateway forbids cookies, nested frames, root-only assets,
    // and live connections. Only this public, read-only adapter fits that profile.
    if(path==='/eagleide'&&['GET','HEAD'].includes(req.method)){res.writeHead(302,{Location:'/eagleide/'});return res.end();}
    if(path.startsWith('/eagleide/')){
      if(!['GET','HEAD'].includes(req.method))fail(405,'The EagleIDE tool is read-only.');
      const name=path.slice('/eagleide/'.length)||'index.html';
      if(name==='data'){
        res.removeHeader('X-Frame-Options');res.removeHeader('Content-Security-Policy');
        const portalUrl=publicUrl || `${tls?'https':'http'}://${req.headers.host}/`;
        if(req.method==='HEAD'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end();}
        return json(res,200,{servers:allRows().map(publicRow),tasks:tasks(),portalUrl});
      }
      const data=toolFiles.get(name);if(!data)fail(404,'Tool resource not found.');
      // The gateway applies its own opaque sandbox and prefix-restricted CSP.
      // Do not forward the main portal's DENY/self policy into this separate view.
      res.removeHeader('X-Frame-Options');res.removeHeader('Content-Security-Policy');
      res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return res.end(req.method==='HEAD'?undefined:data);
    }
    if (path === '/api/events' && req.method === 'GET') {
      if (streams.size >= 500) fail(503,'Too many live connections.');
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.write(`retry: 3000\ndata: ${JSON.stringify(allRows().map(publicRow))}\n\n`); streams.add(res); res.on('close',()=>streams.delete(res)); return;
    }
    if (path === '/api/bootstrap' && req.method === 'GET') return json(res,200,{ servers:allRows().map(publicRow), tasks:tasks(), admin:isAdmin(req), setup:!setting('admin_hash'), local:local(req), remoteSetup:!setting('admin_hash') && !!setupToken, interval:INTERVAL, secure:!!tls, title:setting('title') || 'Eagle-Lab', demo:process.env.LAB_DEMO === '1' });
    if (path === '/api/setup' && req.method === 'POST') {
      if (setting('admin_hash')) fail(409,'Administrator already configured.');
      if (!limiter.check('setup',5)) fail(429,'Too many attempts. Wait a minute.');
      const b = await body(req), password = secretField(b,'password',12,128);
      // Recheck after consuming the request body so concurrent first-run requests cannot overwrite the administrator.
      if (setting('admin_hash')) fail(409,'Administrator already configured.');
      if (!local(req) && (!setupTokenHash || !verify(String(b.token || ''),setupTokenHash))) fail(403,'Complete setup on localhost or enter the host’s SETUP_TOKEN.');
      if (password.length < 12) fail(400,'Use at least 12 characters for the admin password.');
      const username = textField(b,'username',64,true);
      setSetting('admin_user',username); setSetting('admin_hash',hash(password));
      if (existsSync(setupPath)) unlinkSync(setupPath);
      const token = random(); sessions.set(token,{expires:Date.now()+8*3600000});
      return json(res,201,{ok:true},{'Set-Cookie':`lab_admin=${token}; Path=/${cookieOptions}; Max-Age=28800`});
    }
    if (path === '/api/login' && req.method === 'POST') {
      if (!limiter.check(`login:${req.socket.remoteAddress}`,8)) fail(429,'Too many login attempts. Try again in a minute.');
      const b = await body(req);
      if (b.username !== setting('admin_user') || !verify(String(b.password || ''),setting('admin_hash') || '')) fail(401,'Incorrect username or password.');
      const token=random(); sessions.set(token,{expires:Date.now()+8*3600000});
      return json(res,200,{ok:true},{'Set-Cookie':`lab_admin=${token}; Path=/${cookieOptions}; Max-Age=28800`});
    }
    if (path === '/api/logout' && req.method === 'POST') { sessions.delete(cookies(req).lab_admin); return json(res,200,{ok:true},{'Set-Cookie':`lab_admin=; Path=/${cookieOptions}; Max-Age=0`}); }
    let match = path.match(/^\/api\/servers\/([a-f0-9-]+)(?:\/(unlock|connect|tickets))?$/);
    if (match) {
      const row=getRow(match[1]); if (!row) fail(404,'Server not found.');
      if (match[2] === 'unlock' && req.method === 'POST') {
        if (!limiter.check(`pin:${row.id}:${req.socket.remoteAddress}`,8)) fail(429,'Too many PIN attempts. Wait a minute.');
        const b=await body(req); if (row.pin_hash && !isAdmin(req) && !verify(String(b.pin || ''),row.pin_hash)) fail(403,'Incorrect server PIN.');
        return json(res,200,{ok:true},{'Set-Cookie':`lab_node_${row.id}=${grantToken(row,key)}; Path=/${cookieOptions}; Max-Age=28800`});
      }
      if (!unlocked(req,row)) fail(403,'Enter this server’s PIN first.');
      if (!match[2] && req.method === 'GET') return json(res,200,{...publicRow(row), username:row.username, password:unseal(row.password,key), notes:row.notes, proxyPort:row.proxy_port});
      if (match[2] === 'connect' && req.method === 'POST') {
        await startProxy(row); if (proxyErrors.has(row.id)) fail(503,proxyErrors.get(row.id));
        return json(res,200,{port:row.proxy_port,secure:!!tls},{'Set-Cookie':`lab_node_${row.id}=${grantToken(row,key)}; Path=/${cookieOptions}; Max-Age=28800`});
      }
      if (match[2] === 'tickets' && req.method === 'POST') {
        if (!limiter.check(`ticket:${req.socket.remoteAddress}`,5)) fail(429,'Please wait a minute before sending another report.');
        const b=await body(req), id=randomUUID(), now=new Date().toISOString();
        db.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)').run(id,row.id,row.hostname,textField(b,'name',80),textField(b,'subject',120,true),textField(b,'message',4000,true),'open',now,now);
        return json(res,201,{id,ok:true});
      }
    }
    if (path.startsWith('/api/admin/')) {
      if (!isAdmin(req)) fail(401,'Please sign in as an administrator.');
      const resource=path.slice(11).split('/'), id=resource[1];
      if (resource[0] === 'servers') {
        if (req.method === 'GET' && !id) return json(res,200,allRows().map(adminRow));
        if (req.method === 'DELETE' && id) { if (!getRow(id)) fail(404,'Server not found.'); stopProxy(id); db.prepare('DELETE FROM servers WHERE id=?').run(id); states.delete(id); publish(); return json(res,200,{ok:true}); }
        if (['POST','PUT'].includes(req.method)) {
          const old=id ? getRow(id) : null; if (id && !old) fail(404,'Server not found.');
          const b=await body(req), hostname=textField(b,'hostname',80,true), ip=textField(b,'ip',15,true), username=textField(b,'username',64) || 'root', notes=textField(b,'notes',8000);
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(hostname)) fail(400,'Use a hostname containing letters, numbers, dots, or hyphens.');
          if (!validAddress(ip)) fail(400,'Use a private LAN IPv4 address (10.x, 172.16–31.x, or 192.168.x).');
          if (db.prepare('SELECT id FROM servers WHERE ip=? AND id<>?').get(ip,id || '')) fail(409,'This IP is already enrolled.');
          if (!old && (!b.password || typeof b.password !== 'string')) fail(400,'Enter the PVE login password.');
          if (b.password && (typeof b.password !== 'string' || b.password.length > 512)) fail(400,'Password is too long.');
          let pin=old?.pin_hash || null;
          if (b.pinAction === 'remove') pin=null;
          if (b.pinAction === 'set') pin=hash(secretField(b,'pin',4,64));
          let port=old?.proxy_port;
          if (!port) { const used=new Set(allRows().map(r=>r.proxy_port)); for (let p=PROXY_START;p<=PROXY_END;p++) if (!used.has(p) && p!==PORT) { port=p; break; } if (!port) fail(400,'Proxy port range is full.'); }
          const serverId=old?.id || randomUUID(), password=b.password ? seal(b.password,key) : old.password;
          db.prepare(`INSERT INTO servers VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hostname=excluded.hostname,ip=excluded.ip,username=excluded.username,password=excluded.password,pin_hash=excluded.pin_hash,notes=excluded.notes,revision=excluded.revision,allow_self_signed=excluded.allow_self_signed`).run(serverId,hostname,ip,username,password,pin,notes,port,(old?.revision || 0)+1,b.allowSelfSigned === false ? 0 : 1,old?.created_at || new Date().toISOString());
          if (old) stopProxy(old.id);
          const row=getRow(serverId); await startProxy(row); probe(row).then(publish); publish(); return json(res,old ? 200:201,adminRow(row));
        }
      }
      if (resource[0] === 'tickets') {
        if (req.method === 'GET') return json(res,200,db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all());
        if (req.method === 'PATCH' && id) { const b=await body(req); if (!['open','closed'].includes(b.status)) fail(400,'Invalid status.'); const result=db.prepare('UPDATE tickets SET status=?,updated_at=? WHERE id=?').run(b.status,new Date().toISOString(),id); if (!result.changes) fail(404,'Ticket not found.'); return json(res,200,{ok:true}); }
      }
      if (resource[0] === 'tasks') {
        if (req.method === 'GET') return json(res,200,tasks());
        if (req.method === 'DELETE' && id) { db.prepare('DELETE FROM tasks WHERE id=?').run(id); return json(res,200,{ok:true}); }
        if (['POST','PUT'].includes(req.method)) {
          if (id && !db.prepare('SELECT id FROM tasks WHERE id=?').get(id)) fail(404,'Task not found.');
          const b=await body(req), taskId=id || randomUUID(), title=textField(b,'title',160,true), description=textField(b,'description',6000), position=Number.isInteger(b.position) ? b.position : tasks().length;
          db.prepare('INSERT INTO tasks (id,title,description,position) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,position=excluded.position,revision=tasks.revision+1').run(taskId,title,description,position);
          return json(res,200,{ok:true});
        }
      }
      if (resource[0] === 'settings' && req.method === 'PUT') {
        const b=await body(req); if (b.title !== undefined) setSetting('title',textField(b,'title',60,true));
        if (b.password) { if (!verify(String(b.currentPassword || ''),setting('admin_hash'))) fail(403,'Current password is incorrect.'); const pw=secretField(b,'password',12,128); setSetting('admin_hash',hash(pw)); const current=cookies(req).lab_admin; for (const token of sessions.keys()) if (token!==current) sessions.delete(token); }
        return json(res,200,{ok:true});
      }
      fail(404,'Admin endpoint not found.');
    }
    if (path.startsWith('/api/')) fail(404,'Endpoint not found.');
    if (req.method !== 'GET' && req.method !== 'HEAD') fail(405,'Method not allowed.');
    const name=path === '/' ? 'index.html' : path.slice(1);
    const data=files.get(name); if (!data) fail(404,'Page not found.');
    res.writeHead(200,{'Content-Type':name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html', 'Cache-Control':name.startsWith('assets/')?'public, max-age=86400':'no-cache'}); res.end(req.method === 'HEAD' ? undefined : data);
  } catch (err) { if (!res.headersSent) json(res,err.status || 500,{error:err.status ? err.message : 'An unexpected error occurred.'}); else res.end(); if (!err.status) console.error(err); }
}
const server=tls ? https.createServer(tls,handle) : http.createServer(handle);
server.requestTimeout=30000;
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve);});
console.log(`Eagle-Lab: ${tls ? 'https' : 'http'}://localhost:${PORT}`);
if (!setting('admin_hash')) console.log('First run: open the portal on this computer and choose an admin password.');
if (!setting('admin_hash') && setupToken) console.log(`Remote setup token: ${setupToken}`);
await Promise.all(allRows().map(startProxy));
probeAll();
const statusTimer=setInterval(probeAll,INTERVAL), heartbeat=setInterval(()=>{for (const res of streams) sendEvent(res,': heartbeat\n\n');},15000);
const maintenance=setInterval(()=>{for(const [token,s] of sessions) if(s.expires<Date.now()) sessions.delete(token);},60000);
function shutdown() { clearInterval(statusTimer); clearInterval(heartbeat); clearInterval(maintenance); for(const res of streams) res.end(); for(const id of proxies.keys()) stopProxy(id); server.closeAllConnections(); server.close(()=>{db.close();process.exit(0);}); }
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
