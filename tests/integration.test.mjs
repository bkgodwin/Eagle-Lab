import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { validAddress } from '../lib/security.mjs';
import { checkManagement } from '../lib/status.mjs';
import { gzipSync } from 'node:zlib';

async function freePort() { const s=net.createServer(); s.listen(0,'127.0.0.1'); await once(s,'listening'); const port=s.address().port; await new Promise(r=>s.close(r)); return port; }
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('Classroom workflow, access control, durable records, HTTP proxy and terminal WebSockets', {timeout:60000}, async t=>{
  const data=await mkdtemp(join(tmpdir(),'pve-lab-test-')),port=await freePort(),proxyPort=await freePort();
  let child,upstream,eventsReader;
  t.after(async()=>{ if(eventsReader) await eventsReader.cancel().catch(()=>{}); if(child&&!child.killed) { child.kill(); await once(child,'exit').catch(()=>{}); } if(upstream) { upstream.closeAllConnections(); await new Promise(r=>upstream.close(r)); } await rm(data,{recursive:true,force:true}); });
  const cert=await readFile(new URL('fixtures/cert.pem',import.meta.url)), key=await readFile(new URL('fixtures/key.pem',import.meta.url));
  const localIp=Object.values(networkInterfaces()).flat().find(v=>v.family==='IPv4'&&validAddress(v.address))?.address;
  assert.ok(localIp,'A private LAN interface is required for the PVE fixture.');
  let upstreamCookie='', websocketOrigin='', reachable=true,hangProbe=false;
  upstream=https.createServer({cert,key},(req,res)=>{
    if(req.url==='/compressed-ui') { res.writeHead(200,{'Content-Type':'text/html','Content-Encoding':'gzip'});return res.end(gzipSync('<html><head><title>PVE</title></head><body><script>document.cookie="PVEAuthCookie=ticket; Secure"</script></body></html>')); }
    if(req.url==='/api2/json/version') { if(hangProbe) return;res.writeHead(reachable?401:503,{'Content-Type':'application/json'}); return res.end('{"data":null}'); }
    upstreamCookie=req.headers.cookie || '';
    res.writeHead(200,{'Content-Type':'text/html','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"frame-ancestors 'self'",'Set-Cookie':'PVEAuthCookie=fake-pve-ticket; Path=/; Secure; HttpOnly'});
    res.end('<html><body><script>document.cookie="PVEAuthCookie=fake"</script>Mock PVE</body></html>');
  });
  const upstreamSockets=new Set(); upstream.on('connection',s=>{upstreamSockets.add(s);s.on('close',()=>upstreamSockets.delete(s));});
  upstream.on('upgrade',(req,socket)=>{
    websocketOrigin=req.headers.origin;
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data',chunk=>socket.write(chunk)); socket.on('error',()=>{});
  });
  upstream.listen(8006,'0.0.0.0'); await once(upstream,'listening');
  const certificateFailure=await checkManagement({ip:localIp,allow_self_signed:0});
  assert.equal(certificateFailure.status,'down');assert.match(certificateFailure.statusReason,/certificate validation failed/);
  hangProbe=true;const timedOut=await checkManagement({ip:localIp,allow_self_signed:1},500);hangProbe=false;
  assert.equal(timedOut.status,'down');assert.match(timedOut.statusReason,/timed out after 0.5 seconds/);
  const start=async()=>{
    child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:data,HOST:'127.0.0.1',PORT:String(port),PROXY_PORT_START:String(proxyPort),PROXY_PORT_END:String(proxyPort+10),STATUS_INTERVAL_MS:'2000'},stdio:['ignore','pipe','pipe']});
    let output=''; child.stdout.on('data',v=>output+=v); child.stderr.on('data',v=>output+=v);
    for(let i=0;i<100;i++) { if(output.includes('Eagle-Lab:')) return; if(child.exitCode!==null) throw Error(output); await delay(50); } throw Error('Server did not start: '+output);
  };
  await start();
  const base=`http://127.0.0.1:${port}`;
  const adminPassword=' test-admin-password-123 ';
  const request=async(path,method='GET',data,cookie='',origin)=>{
    const response=await fetch(base+path,{method,headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,body:await response.json(),cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
  };
  assert.equal((await request('/api/bootstrap')).body.setup,true);
  assert.equal((await request('/api/admin/servers')).status,401);
  assert.equal((await request('/api/setup','POST',{username:'instructor',password:'too short'})).status,400);
  const setup=await request('/api/setup','POST',{username:'instructor',password:adminPassword}); assert.equal(setup.status,201); const admin=setup.cookie;
  assert.equal((await request('/api/setup','POST',{})).status,409);
  assert.equal((await request('/api/admin/servers','POST',{},admin,'http://attacker.test')).status,403);
  assert.equal((await request('/api/login','POST',{username:'instructor',password:'wrong'})).status,401);
  const titleBody=Buffer.from(JSON.stringify({title:'Eagle-Lab 🦅'}));
  const split=titleBody.indexOf(Buffer.from('🦅'))+1;
  const utf8Result=await new Promise((resolve,reject)=>{
    const req=http.request(base+'/api/admin/settings',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:admin}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.write(titleBody.subarray(0,split));setTimeout(()=>req.end(titleBody.subarray(split)),30);
  });
  assert.equal(utf8Result,200);assert.equal((await request('/api/bootstrap')).body.title,'Eagle-Lab 🦅');
  assert.equal((await request('/api/admin/servers','POST',{hostname:'unsafe',ip:'127.0.0.1',password:'fake'},admin)).status,400);
  const enrolled=await request('/api/admin/servers','POST',{hostname:'pve-student-01',ip:localIp,username:'root',password:'fake-root-password',notes:'Lab network notes',pinAction:'set',pin:' 1234 '},admin);
  assert.equal(enrolled.status,201,JSON.stringify(enrolled.body)); const id=enrolled.body.id;
  assert.equal((await request(`/api/servers/${id}`)).status,403);
  const publicData=(await request('/api/bootstrap')).body;
  assert.equal(publicData.servers[0].password,undefined); assert.equal(publicData.servers[0].notes,undefined); assert.equal(publicData.servers[0].pin_hash,undefined);
  assert.equal((await request(`/api/servers/${id}/unlock`,'POST',{pin:'0000'})).status,403);
  const unlock=await request(`/api/servers/${id}/unlock`,'POST',{pin:' 1234 '}); const student=unlock.cookie;
  const details=await request(`/api/servers/${id}`,'GET',undefined,student);
  assert.equal(details.body.password,'fake-root-password'); assert.equal(details.body.username,'root'); assert.equal(details.body.notes,'Lab network notes');
  const connection=await request(`/api/servers/${id}/connect`,'POST',{},student); assert.equal(connection.status,200);
  const proxyBase=`http://127.0.0.1:${connection.body.port}`;
  assert.equal((await fetch(proxyBase)).status,403);
  assert.equal((await fetch(proxyBase,{headers:{Cookie:student,Origin:'http://untrusted.lan'}})).status,403);
  const proxied=await fetch(proxyBase,{headers:{Cookie:student+'; lab_admin=should-never-forward; PVEAuthCookie=other-node'}});
  assert.equal(proxied.status,200); assert.equal(proxied.headers.get('x-frame-options'),null);
  assert.ok(proxied.headers.get('content-security-policy').includes(`http://127.0.0.1:${port}`));
  const html=await proxied.text(),name=`PVEAuthCookie_${id.replaceAll('-','')}`;
  assert.ok(html.includes(name)); assert.ok(proxied.headers.get('set-cookie').includes(name)); assert.ok(!proxied.headers.get('set-cookie').includes('Secure'));
  assert.ok(html.includes('/_eagle/cookie-bridge.js'));
  const bridge=await fetch(proxyBase+'/_eagle/cookie-bridge.js',{headers:{Cookie:student}});
  assert.equal(bridge.status,200);assert.ok((await bridge.text()).includes('const secure = false'));
  assert.equal((await fetch(proxyBase+'/_eagle/cookie-bridge.js')).status,403);
  const compressed=await fetch(proxyBase+'/compressed-ui',{headers:{Cookie:student}});
  assert.equal(compressed.headers.get('content-encoding'),null);const decoded=await compressed.text();
  assert.ok(decoded.indexOf('/_eagle/cookie-bridge.js')<decoded.indexOf('document.cookie'));
  assert.ok(decoded.includes(name));
  await fetch(proxyBase,{headers:{Cookie:`${student}; ${name}=my-pve-ticket; PVEAuthCookie_other=wrong; lab_admin=secret`}});
  assert.equal(upstreamCookie,'PVEAuthCookie=my-pve-ticket');
  const background=await fetch(base+'/assets/datacenter.jpg');assert.equal(background.status,200);assert.equal(background.headers.get('content-type'),'image/jpeg');
  assert.ok((await background.arrayBuffer()).byteLength>10000);
  const socket=await new Promise((resolve,reject)=>{
    const req=http.request(proxyBase,{headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ==',Cookie:student,Origin:proxyBase}});
    req.on('upgrade',(_res,s)=>resolve(s)); req.on('error',reject); req.on('response',res=>reject(Error(`Upgrade failed: ${res.statusCode}`))); req.end();
  });
  socket.write(Buffer.from([0,1,2,255])); const [echo]=await once(socket,'data'); assert.deepEqual(echo,Buffer.from([0,1,2,255]));
  assert.equal(websocketOrigin,`https://${localIp}:8006`);
  const ticket=await request(`/api/servers/${id}/tickets`,'POST',{subject:'Container failed',message:'Synthetic issue for integration test',name:'Test student'},student); assert.equal(ticket.status,201);
  assert.equal((await request('/api/admin/tickets')).status,401);
  assert.equal((await request(`/api/admin/tickets/${ticket.body.id}`,'PATCH',{status:'closed'},admin)).status,200);
  assert.equal((await request('/api/admin/tickets','GET',undefined,admin)).body[0].status,'closed');
  await request('/api/admin/tasks','POST',{title:'Create a container',description:'Use the assigned host.',position:0},admin);
  const task=(await request('/api/bootstrap')).body.tasks[0]; assert.equal(task.revision,1);
  await request(`/api/admin/tasks/${task.id}`,'PUT',{title:'Create two containers',description:'Updated instructions',position:0},admin);
  assert.equal((await request('/api/bootstrap')).body.tasks[0].revision,2);
  const eventResponse=await fetch(base+'/api/events'); eventsReader=eventResponse.body.getReader(); const first=await eventsReader.read(); assert.ok(new TextDecoder().decode(first.value).includes('data:'));
  for(let i=0;i<30;i++) { if((await request('/api/bootstrap')).body.servers[0].status==='up') break; await delay(100); }
  assert.equal((await request('/api/bootstrap')).body.servers[0].status,'up');
  assert.equal((await request('/api/bootstrap')).body.servers[0].httpStatus,401);
  assert.match((await request('/api/bootstrap')).body.servers[0].statusReason,/sign-in required/);
  reachable=false; await delay(2400); assert.equal((await request('/api/bootstrap')).body.servers[0].status,'down');
  const closed=once(socket,'close');
  await request(`/api/admin/servers/${id}`,'PUT',{hostname:'pve-student-01',ip:localIp,username:'root',notes:'Updated notes',pinAction:'set',pin:'5678'},admin);
  await closed; assert.equal((await request(`/api/servers/${id}`,'GET',undefined,student)).status,403);
  assert.equal((await fetch(proxyBase,{headers:{Cookie:student}})).status,403);
  await request(`/api/admin/servers/${id}`,'PUT',{hostname:'pve-student-01',ip:localIp,username:'root',notes:'Open notes',pinAction:'remove'},admin);
  assert.equal((await request(`/api/servers/${id}`)).status,200);
  await eventsReader.cancel(); eventsReader=null;
  child.kill(); await once(child,'exit'); await start();
  const persisted=(await request('/api/bootstrap')).body; assert.equal(persisted.setup,false); assert.equal(persisted.servers.length,1); assert.equal(persisted.tasks.length,1);
  assert.equal((await request('/api/admin/servers','GET',undefined,admin)).status,401);
  const login=await request('/api/login','POST',{username:'instructor',password:adminPassword}); assert.equal(login.status,200);
  await request(`/api/admin/servers/${id}`,'DELETE',{},login.cookie); assert.equal((await request('/api/bootstrap')).body.servers.length,0);
  const retained=(await request('/api/admin/tickets','GET',undefined,login.cookie)).body[0]; assert.equal(retained.server_id,null); assert.equal(retained.server_name,'pve-student-01');
  for(const s of upstreamSockets) s.destroy();
});

test('HTTPS serves the portal with secure session cookies and clipboard policy', {timeout:15000}, async t=>{
  const data=await mkdtemp(join(tmpdir(),'pve-lab-tls-')),port=await freePort();
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:data,HOST:'127.0.0.1',PORT:String(port),TLS_CERT:fileURLToPath(new URL('fixtures/cert.pem',import.meta.url)),TLS_KEY:fileURLToPath(new URL('fixtures/key.pem',import.meta.url))},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(!child.killed){child.kill();await once(child,'exit').catch(()=>{});}await rm(data,{recursive:true,force:true});});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  for(let i=0;i<100&&!output.includes('Eagle-Lab:');i++){if(child.exitCode!==null) throw Error(output);await delay(50);}
  const request=(path,body)=>new Promise((resolve,reject)=>{
    const req=https.request({hostname:'127.0.0.1',port,path,rejectUnauthorized:false,method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)}));
    });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
  assert.equal((await request('/api/bootstrap')).body.secure,true);
  let slowRequest;
  const slowResponse=new Promise((resolve,reject)=>{
    slowRequest=https.request({hostname:'127.0.0.1',port,path:'/api/setup',method:'POST',rejectUnauthorized:false,headers:{'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    slowRequest.on('error',reject);slowRequest.write('{');
  });
  await delay(40);
  const setup=await request('/api/setup',{username:'teacher',password:'test-https-password-123'});
  assert.equal(setup.status,201);assert.ok(setup.headers['set-cookie'][0].includes('; Secure'));
  slowRequest.end('"username":"intruder","password":"test-should-not-overwrite"}');
  assert.equal(await slowResponse,409);
  assert.equal((await request('/api/login',{username:'teacher',password:'test-https-password-123'})).status,200);
  assert.ok(setup.headers['permissions-policy'].includes('clipboard-read'));
  assert.ok(setup.headers['content-security-policy'].includes('frame-src https:'));
});

test('Headless Ubuntu hosting supports one-time remote administrator setup', {timeout:15000}, async t=>{
  const data=await mkdtemp(join(tmpdir(),'eagle-lab-setup-')),port=await freePort();
  const ip=Object.values(networkInterfaces()).flat().find(v=>v.family==='IPv4'&&validAddress(v.address))?.address;
  assert.ok(ip,'A private LAN interface is required.');
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:data,HOST:'0.0.0.0',PORT:String(port),AUTO_SETUP:'1',SETUP_TOKEN:''},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(!child.killed){child.kill();await once(child,'exit').catch(()=>{});}await rm(data,{recursive:true,force:true});});
  let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
  for(let i=0;i<100&&!output.includes('Remote setup token:');i++){if(child.exitCode!==null)throw Error('Setup server exited early.');await delay(50);}
  const token=await readFile(join(data,'setup-token.txt'),'utf8');assert.equal(token.length,64);
  if(process.platform!=='win32') assert.equal((await stat(join(data,'setup-token.txt'))).mode & 0o777,0o600);
  const base=`http://${ip}:${port}`;
  const bootstrap=await(await fetch(base+'/api/bootstrap')).json();
  assert.equal(bootstrap.local,false);assert.equal(bootstrap.remoteSetup,true);assert.ok(!JSON.stringify(bootstrap).includes(token));
  const setup=token=>fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'teacher',password:'test-remote-password-123',token})});
  assert.equal((await setup('wrong-token')).status,403);
  assert.equal((await setup(token)).status,201);
  await assert.rejects(readFile(join(data,'setup-token.txt')),{code:'ENOENT'});
  assert.equal((await(await fetch(base+'/api/bootstrap')).json()).remoteSetup,false);
});
