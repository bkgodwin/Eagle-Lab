// Disposable local-only fixture for manual browser QA; never uses real PVE credentials.
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import https from 'node:https';
import { hash,seal } from '../lib/security.mjs';
const dir=resolve('test-results/ui'); mkdirSync(dir,{recursive:true});
const env={...process.env,DATA_DIR:dir,HOST:'127.0.0.1',PORT:'3300',PROXY_PORT_START:'8300',PROXY_PORT_END:'8399',LAB_DEMO:'1'};
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
  res.writeHead(200,{'Content-Type':'text/html','X-Frame-Options':'SAMEORIGIN'});
  res.end('<!doctype html><html><head><title>Simulated PVE</title><style>body{background:#181818;color:#ddd;font:15px monospace;padding:25px}textarea{display:block;width:95%;height:55vh;background:#080808;color:#a7df8c;border:1px solid #555;padding:15px;font:15px monospace}</style></head><body><h1>Simulated PVE management interface</h1><p>This local QA fixture is not a real Proxmox server.</p><label>Terminal input (text is never executed)<textarea aria-label="Simulated terminal" spellcheck="false">root@pve-student-01:~# </textarea></label></body></html>');
});
fixture.listen(8006,'127.0.0.1');await once(fixture,'listening');
child=launch();child.stdout.pipe(process.stdout);
console.log('Disposable preview at http://localhost:3300. PIN 1234. Instructor test-only-admin-1234.');
const stop=()=>{child.kill();fixture.closeAllConnections();fixture.close(()=>process.exit(0));};process.on('SIGINT',stop);process.on('SIGTERM',stop);
