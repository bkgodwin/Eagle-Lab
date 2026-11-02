// Disposable local-only fixture for manual browser QA; never uses real PVE credentials.
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import https from 'node:https';
import http from 'node:http';
import {createHash} from 'node:crypto';
import { hash,seal } from '../lib/security.mjs';
const dir=resolve('test-results/ui'); mkdirSync(dir,{recursive:true});
const env={...process.env,DATA_DIR:dir,HOST:process.env.LAB_PREVIEW_HOST || '127.0.0.1',PORT:'3300',PROXY_PORT_START:'8300',PROXY_PORT_END:'8399',LAB_DEMO:'1'};
const launch=()=>spawn(process.execPath,['server.mjs'],{env,stdio:['ignore','pipe','inherit']});
let child=launch(); await once(child.stdout,'data'); child.kill(); await once(child,'exit');
const db=new DatabaseSync(resolve(dir,'lab.sqlite')),key=readFileSync(resolve(dir,'secret.key'));
db.exec('DELETE FROM tickets; DELETE FROM servers; DELETE FROM tasks;');
db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run('admin_user','instructor');
db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run('admin_hash',hash('test-only-admin-1234'));
const insert=db.prepare('INSERT INTO servers VALUES (?,?,?,?,?,?,?,?,?,?,?)');
insert.run('11111111-1111-4111-8111-111111111111','pve-student-01','127.0.0.1','root',seal('test-only-password',key),hash('1234'),'Your lab network is 10.10.1.0/24. Start by exploring the node summary and checking available storage.',8300,1,1,new Date().toISOString());
insert.run('22222222-2222-4222-8222-222222222222','pve-student-02','127.0.0.2','root',seal('test-only-password',key),null,'This node is intentionally offline in the preview.',8301,1,1,new Date().toISOString());
insert.run('33333333-3333-4333-8333-333333333333','pve-student-03','127.0.0.3','root',seal('test-only-password',key),hash('5678'),'',8302,1,1,new Date().toISOString());
const tasks=[['Explore your Proxmox node','Locate CPU, memory, storage, and networking details in the node summary.'],['Create your first LXC container','Choose a Debian template, allocate resources, and start your container.'],['Check network connectivity','Inspect the container IP and routing table, then test connectivity to the gateway.']];
tasks.forEach(([title,description],i)=>db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?)').run('task-'+i,title,description,i,1));db.close();
const fixture=https.createServer({key:readFileSync(new URL('fixtures/key.pem',import.meta.url)),cert:readFileSync(new URL('fixtures/cert.pem',import.meta.url))},(req,res)=>{
  if(req.url==='/api2/json/version'){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"data":{"version":"test"}}');}
  if(req.url==='/api2/json/browser-auth') { const valid=(req.headers.cookie || '').includes('PVEAuthCookie=test-ticket');res.writeHead(valid?200:401,{'Content-Type':'application/json'});return res.end(JSON.stringify({authenticated:valid})); }
  if(new URL(req.url,'https://fixture').searchParams.get('novnc')==='1'){
    res.writeHead(200,{'Content-Type':'text/html','X-Frame-Options':'SAMEORIGIN'});
    return res.end(`<!doctype html><html><head><title>Nested VNC fixture</title></head><body style="background:#0c1628;color:#cce3ff;font:16px monospace;padding:20px"><h2>Nested VM console</h2><p id="vnc-result">Connecting with PVE's encrypted WebSocket default…</p><canvas id="screen" width="600" height="200"></canvas><script>
    const ws=new WebSocket('wss://'+location.host+'/api2/json/nodes/pve/qemu/100/vncwebsocket?port=5900&vncticket=test%2Bticket%3D',['binary']);ws.binaryType='arraybuffer';
    ws.onmessage=e=>{const greeting=new TextDecoder().decode(e.data);document.getElementById('vnc-result').textContent=greeting.startsWith('RFB ')?'Nested VM console connected: binary RFB greeting received':'Unexpected greeting';const ctx=document.getElementById('screen').getContext('2d');ctx.fillStyle='#17365c';ctx.fillRect(0,0,600,200);ctx.fillStyle='#8ee3b7';ctx.font='20px monospace';ctx.fillText('VNC transport verified',28,70);ctx.font='14px monospace';ctx.fillText('Synthetic VM fixture, not a real guest',28,110);ws.close();};
    ws.onerror=()=>document.getElementById('vnc-result').textContent='VNC WebSocket failed';
    </script></body></html>`);
  }
  res.writeHead(200,{'Content-Type':'text/html','X-Frame-Options':'SAMEORIGIN'});
  res.end(`<!doctype html><html><head><title>Simulated PVE</title><style>body{background:#181818;color:#ddd;font:15px monospace;padding:25px}textarea{display:block;width:95%;height:45vh;background:#080808;color:#a7df8c;border:1px solid #555;padding:15px;font:15px monospace}button{padding:10px;margin:10px}</style></head><body><h1>Simulated PVE management interface</h1><p>This local QA fixture is not a real Proxmox server.</p><button id="signin">Test HTTP login cookie</button><button id="signout">Test logout cookie</button><p id="auth-result">No test session yet</p><script>
  async function check(){const r=await fetch('/api2/json/browser-auth');document.getElementById('auth-result').textContent=r.ok?'Authenticated: browser cookie reached PVE':'Unauthorized: no session cookie';}
  document.getElementById('signin').onclick=()=>{document.cookie='PVEAuthCookie=test-ticket; Path=/; Secure; SameSite=Lax';check();};
  document.getElementById('signout').onclick=()=>{document.cookie='PVEAuthCookie=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Lax';check();};
  </script><button id="open-vnc">Open nested VM console</button><div id="nested-host"></div><script>document.getElementById('open-vnc').onclick=()=>{document.getElementById('nested-host').innerHTML='<iframe title="Nested VM VNC console" src="/?console=kvm&novnc=1&vmid=100&node=pve" style="width:100%;height:370px;border:1px solid #5276aa"></iframe>';};</script><label>Terminal input (text is never executed)<textarea aria-label="Simulated terminal" spellcheck="false">root@pve-student-01:~# </textarea></label></body></html>`);
});
const fixtureSockets=new Set();fixture.on('connection',socket=>{fixtureSockets.add(socket);socket.on('close',()=>fixtureSockets.delete(socket));});
fixture.on('upgrade',(req,socket)=>{
  if(!(req.headers.cookie || '').includes('PVEAuthCookie=test-ticket')||req.headers['sec-websocket-protocol']!=='binary'){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: binary\r\n\r\n`);
  const greeting=Buffer.from('RFB 003.008\n');socket.write(Buffer.concat([Buffer.from([0x82,greeting.length]),greeting]));
  socket.on('data',chunk=>{if((chunk[0]&15)===8)socket.end(Buffer.from([0x88,0]));});socket.on('error',()=>{});
});
fixture.listen(8006,'127.0.0.1');await once(fixture,'listening');
child=launch();child.stdout.pipe(process.stdout);
console.log('Disposable preview at http://localhost:3300. PIN 1234. Instructor test-only-admin-1234.');
// Contract fixture mirrors EagleIDE's reviewed opaque sandbox and gateway prefix;
// it does not run or alter a real EagleIDE installation or its accounts.
const gateway=http.createServer((req,res)=>{
  const prefix='/tool-session/app/',origin=`http://${req.headers.host}`,source=origin+prefix;
  if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<!doctype html><html><head><title>EagleIDE sandbox contract fixture</title></head><body style="margin:0;background:#080e18"><iframe title="Eagle-Lab restricted tool" sandbox="allow-scripts allow-downloads" src="/tool-session/app/" style="border:0;width:100%;height:100vh"></iframe></body></html>');}
  if(!req.url.startsWith(prefix)||!['GET','HEAD'].includes(req.method)){res.writeHead(404);return res.end();}
  const path=req.url.slice(prefix.length),up=http.request('http://127.0.0.1:3300/eagleide/'+path,{method:req.method,headers:{Accept:req.headers.accept||'*/*'}},incoming=>{
    res.writeHead(incoming.statusCode,{'Content-Type':incoming.headers['content-type']||'text/plain','Cache-Control':'no-store','Access-Control-Allow-Origin':'null','Content-Security-Policy':`sandbox allow-scripts allow-downloads; default-src 'none'; script-src ${source} 'unsafe-inline' 'wasm-unsafe-eval'; style-src ${source} 'unsafe-inline'; connect-src ${source}; img-src ${source} data: blob:; font-src ${source} data:; media-src ${source} blob:; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${origin}`});incoming.pipe(res);
  });up.on('error',()=>{res.writeHead(502);res.end();});up.end();
});
gateway.listen(3400,env.HOST);await once(gateway,'listening');console.log('Opaque EagleIDE gateway contract fixture: http://localhost:3400');
const stop=()=>{child.kill();gateway.closeAllConnections();gateway.close();fixture.closeAllConnections();for(const socket of fixtureSockets)socket.destroy();fixture.close(()=>process.exit(0));};process.on('SIGINT',stop);process.on('SIGTERM',stop);
