import { terms, commands } from './reference.js';

const $ = s => document.querySelector(s);
const app = $('#app'), overlay = $('#overlay');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
 eagle:'m2 5 8 3 2-3 2 3 8-3-4 8-6 7-6-7zm8 3 2 7 2-7', terminal:'m4 6 6 6-6 6m9 0h7', grid:'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
 server:'M4 3h16v7H4zm0 11h16v7H4zM7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5',
 book:'M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1m0-15c3-2 6-2 10-1v15c-4-1-7-1-10 1zm0 0v15',
 tasks:'m3 6 2 2 3-4m3 2h10M3 13l2 2 3-4m3 2h10M3 20l2 2 3-4m3 2h10',
 lock:'M6 10h12v11H6zm3 0V6a3 3 0 0 1 6 0v4m-3 5v2',
 arrow:'M5 12h14m-5-5 5 5-5 5', chevron:'m9 5 7 7-7 7', plus:'M12 5v14M5 12h14',
 search:'M21 21l-5-5m2-6a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
 up:'m3 12 4-4 4 4 4-8 6 8', down:'M3 12h4l3 6 4-12 3 6h4',
 close:'m6 6 12 12M6 18 18 6', copy:'M9 9h12v12H9zM15 9V3H3v12h6',
 external:'M14 3h7v7m0-7L10 14M11 3H3v18h18v-8',
 edit:'m15 4 5 5M4 15 15 4a3.5 3.5 0 0 1 5 5L9 20l-6 1z',
 trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
 ticket:'M3 4h18v12H9l-6 5zM7 8h10M7 12h7',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
 logout:'M9 3H3v18h6m6-15 6 6-6 6M8 12h13',
 check:'m5 12 4 4L19 6', info:'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 back:'M20 12H4m6-6-6 6 6 6', shield:'m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6z', bolt:'m13 2-9 12h7l-1 8 10-13h-7z'
};
const icon = (name, cls='') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.info}"/></svg>`;
let state = { servers:[],tasks:[],admin:false,setup:false,local:false,title:'Eagle-Lab', live:false, interval:5000, secure:false };
let route='overview', adminServers=[], tickets=[], filter='', statusFilter='all', refCategory='Key terms', refSearch='', ticketFilter='open', detail=null, workspace=null, returnFocus=null, renderId=0;
let completed={}; try { completed=JSON.parse(localStorage.getItem('lab-task-progress') || '{}'); if (!completed || Array.isArray(completed) || typeof completed !== 'object') completed={}; } catch {}
const done = t => completed[t.id] === t.revision;
const progress = () => state.tasks.filter(done).length;
async function api(path, method='GET', data) {
  const response = await fetch(path,{method,headers: data !== undefined ? {'Content-Type':'application/json'} : {},body:data === undefined ? undefined : JSON.stringify(data),credentials:'same-origin'});
  const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.error || 'Request failed.'),{status:response.status}); return value;
}
function toast(message) { const node=document.createElement('div'); node.className='toast'; node.textContent=message; $('#toasts').append(node); setTimeout(()=>node.remove(),4500); }
function status(row) { return `<span class="status ${esc(row.status)}" data-node-status="${esc(row.id)}">${row.status==='up' ? '● Up' : row.status==='down' ? '● Down' : '◌ Checking'}</span>`; }
function nav(href,name,symbol,active,count='') { return `<a class="nav-item ${active?'active':''}" href="#${href}">${icon(symbol)}<span>${name}</span>${count ? `<span class="count">${count}</span>`:''}</a>`; }
function shell(content) {
  const adminRoute=route.startsWith('admin'), label=({overview:'Lab overview',reference:'Command reference',tasks:'Lab tasks','admin/servers':'Server management','admin/tickets':'Issue tickets','admin/tasks':'Task management','admin/settings':'Settings'})[route] || 'Lab overview';
  return `<div class="shell ${route==='overview'?'home-shell':''}"><aside class="sidebar"><a href="#overview" class="brand"><div class="brand-icon">${icon('eagle')}</div><div><div class="brand-name">${esc(state.title)}</div><div class="brand-sub">Eagle workspace</div></div></a><div class="nav-caption">WORKSPACE</div><nav>${nav('overview','Lab overview','grid',route==='overview')}${nav('reference','Command reference','book',route==='reference')}${nav('tasks','Lab tasks','tasks',route==='tasks',state.tasks.length ? `${progress()}/${state.tasks.length}`:'')}</nav>${state.admin ? `<div class="nav-caption">ADMINISTRATION</div><nav>${nav('admin/servers','Manage servers','server',route==='admin/servers')}${nav('admin/tickets','Issue tickets','ticket',route==='admin/tickets')}${nav('admin/tasks','Manage tasks','edit',route==='admin/tasks')}${nav('admin/settings','Settings','settings',route==='admin/settings')}</nav>`:''}<div class="sidebar-bottom"><div class="network-tag"><span class="dot ${state.live?'':'off'}"></span><span id="live-label">${state.live?'Lab feed connected':'Connecting to lab…'}</span><p>Private classroom network</p></div>${state.admin ? `<button class="nav-item icon-btn" data-action="logout">${icon('logout')} Sign out</button>` : `<button class="nav-item icon-btn" data-action="login">${icon('lock')} Instructor sign in</button>`}<div class="side-foot">Eagle-Lab · Proxmox VE</div></div></aside><header class="topbar"><div class="breadcrumb">${icon('server')}<span>Workspace</span><span>/</span><strong>${label}</strong></div><div class="top-actions"><span class="pill live"><span class="dot"></span>LAN workspace</span>${state.admin ? `<button class="avatar" data-action="logout" title="Sign out" aria-label="Sign out">AD</button>` : `<button class="icon-btn" data-action="login" aria-label="Instructor sign in">${icon('lock')}</button>`}</div></header><main class="main">${state.demo ? '<div class="notice">Preview data · These sample nodes are not real servers.</div>':''}${content}<footer class="bottom-note"><span>${icon('terminal')} ${esc(state.title)} &nbsp; / &nbsp; Your space to build, break, and learn.</span><span>Powered by Proxmox VE</span></footer></main></div>`;
}
function heading(eyebrow,title,description,action='') { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${description}</p></div>${action}</div>`; }
function empty(title,description,symbol='server',action='') { return `<div class="empty">${icon(symbol)}<h3>${title}</h3><p>${description}</p>${action}</div>`; }
function overview() {
  return `<section class="home-hero"><div class="eyebrow">EAGLE-LAB / STUDENT WORKSPACE</div><h1>Build. Break. Learn.</h1><p>Your server. Your experiments. Your next breakthrough.</p><a class="hero-reference" href="#reference">${icon('book')} Command reference ${icon('arrow')}</a></section>${state.setup ? `<div class="notice">${state.local ? 'Welcome to your new lab. Create your instructor account to enroll the first server. <button class="text-link" data-action="login">Set up administrator →</button>':'Your instructor is preparing the lab. Servers will appear here when enrolled.'}</div>`:''}<div class="stats" id="stats">${stats()}</div><div class="content-grid"><section><div class="section-heading"><h2>Your lab servers <span class="badge-muted" id="server-count">${state.servers.length}</span></h2><span class="meta">Live status · every ${state.interval/1000}s</span></div><div class="toolbar"><div class="search">${icon('search')}<input id="server-search" type="search" placeholder="Search hostname or IP address…" aria-label="Search servers" value="${esc(filter)}"></div><select id="status-filter" aria-label="Filter server status"><option value="all" ${statusFilter==='all'?'selected':''}>All statuses</option><option value="up" ${statusFilter==='up'?'selected':''}>Up</option><option value="down" ${statusFilter==='down'?'selected':''}>Down</option></select></div><div id="server-list" class="server-list">${serverList()}</div><p class="server-caption">${icon('shield')} A lock indicates a server PIN. Ask your instructor for access.</p></section><aside class="aside"><section class="panel"><div class="panel-head"><h2>Today's lab tasks</h2>${icon('tasks')}</div><div class="panel-body" id="mini-tasks">${miniTasks()}</div><a class="panel-footer" href="#tasks">View all tasks ${icon('arrow')}</a></section><div class="guide-card"><div class="guide-icon">${icon('book')}</div><h3>A little help at your fingertips.</h3><p>Linux basics, networking, containers, and all the Proxmox commands you’ll need.</p><a href="#reference">Explore command reference ${icon('arrow')}</a></div><p class="help-note"><strong>Something not working?</strong><br>Open your server and select “Report an issue” to let your instructor know.</p></aside></div>`;
}
function stats() {
  const up=state.servers.filter(s=>s.status==='up').length, down=state.servers.filter(s=>s.status==='down').length;
  return `<div class="stat"><span class="stat-label">${icon('server')} Enrolled</span><span class="stat-value">${state.servers.length}</span></div><div class="stat"><span class="stat-label"><span class="dot"></span>Online</span><span class="stat-value">${up}</span></div><div class="stat"><span class="stat-label"><span class="dot off"></span>Offline</span><span class="stat-value">${down}</span></div><span class="stats-caption">Live classroom status</span>`;
}
function serverList() {
  const rows=state.servers.filter(s=>(s.hostname+' '+s.ip).toLowerCase().includes(filter.toLowerCase()) && (statusFilter==='all'||s.status===statusFilter));
  if (!rows.length) return state.servers.length ? empty('No matching servers','Try a different hostname, address, or status.','search') : empty('The lab is waiting for its first node.','Your instructor can enroll Proxmox servers. They’ll appear here automatically.','server',state.admin ? '<button class="btn primary" data-action="new-server">Enroll a server</button>':'');
  return rows.map(s=>`<button class="server-row ${esc(s.status)}" data-action="server" data-id="${s.id}"><div class="server-icon">${icon('server')}</div><div class="server-info"><div class="server-name">${esc(s.hostname)} ${s.protected ? icon('lock'):''}</div><div class="server-ip">${esc(s.ip)} <span class="muted">:8006</span></div></div><div class="row-end">${status(s)}${icon('chevron')}</div></button>`).join('');
}
function updateLiveOverview() {
  const list=$('#server-list'),stat=$('#stats');
  if(list) {
    const signature=JSON.stringify([filter,statusFilter,state.servers.map(s=>[s.id,s.hostname,s.ip,s.protected,statusFilter==='all'?'':s.status])]);
    if(list.dataset.signature!==signature) { list.innerHTML=serverList(); list.dataset.signature=signature; }
    else list.querySelectorAll('.server-row').forEach(el=>{ const row=state.servers.find(s=>s.id===el.dataset.id); if(row) el.className=`server-row ${row.status}`; });
  }
  const counts=JSON.stringify([state.servers.length,state.servers.filter(s=>s.status==='up').length,state.servers.filter(s=>s.status==='down').length]);
  if(stat&&stat.dataset.counts!==counts) { stat.innerHTML=stats(); stat.dataset.counts=counts; }
  if($('#server-count')) $('#server-count').textContent=state.servers.length;
}
function miniTasks(all=false) { return `${state.tasks.length ? `<div class="task-summary"><span>Your progress</span><span>${progress()} of ${state.tasks.length} complete</span></div><div class="progress-track"><span style="width:${state.tasks.length ? progress()/state.tasks.length*100:0}%"></span></div>${state.tasks.slice(0,all?state.tasks.length:4).map(t=>`<div class="mini-task"><input id="mini-${t.id}" type="checkbox" data-task="${t.id}" ${done(t)?'checked':''}><label for="mini-${t.id}">${esc(t.title)}${all&&t.description?`<span class="mini-task-description">${esc(t.description)}</span>`:''}</label></div>`).join('')}`:'<p class="muted" style="font-size:12px">Your instructor hasn’t posted any tasks yet. Check back soon.</p>'}`; }
function taskPage(admin=false) {
  return `${heading(admin?'ADMINISTRATION':'LEARNING PATH',admin?'Shape the next lab.':'One step closer to confident.',admin?'Create and arrange the tasks students see in their workspace.':'Work through your lab at your own pace. Progress is saved in this browser.',admin?'<button class="btn primary" data-action="new-task">'+icon('plus')+' Add task</button>':'')}${!admin&&state.tasks.length?`<div class="panel panel-body" style="margin-bottom:24px"><div class="task-summary"><span>Lab progress</span><span>${progress()} / ${state.tasks.length} tasks</span></div><div class="progress-track"><span style="width:${progress()/state.tasks.length*100}%"></span></div></div>`:''}${state.tasks.length ? state.tasks.map((t,i)=>`<article class="task-card ${!admin&&done(t)?'done':''}">${admin ? `<div class="server-icon">${icon('tasks')}</div>`:`<input type="checkbox" data-task="${t.id}" aria-label="Complete ${esc(t.title)}" ${done(t)?'checked':''}>`}<div class="task-body"><div class="task-number">TASK ${String(i+1).padStart(2,'0')}</div><h3>${esc(t.title)}</h3>${t.description?`<p>${esc(t.description)}</p>`:''}</div>${admin?`<div class="task-actions"><button class="icon-btn" title="Edit task" data-action="edit-task" data-id="${t.id}">${icon('edit')}</button><button class="icon-btn" title="Delete task" data-action="delete-task" data-id="${t.id}">${icon('trash')}</button></div>`:''}</article>`).join(''):empty('A fresh page for learning.',admin?'Add your first task to give students a starting point.':'Lab tasks will appear here when your instructor posts them.','tasks')}${!admin?'<p class="muted" style="font-size:11px;margin-top:20px">Progress belongs to this browser and device. Edited tasks may need to be completed again.</p>':''}`;
}
const categories=['Key terms',...new Set(commands.map(c=>c[0]))];
function referencePage() { return `${heading('THE FIELD GUIDE','A good command goes a long way.','A quick reference for Linux and Proxmox VE. Understand it, then run it.')}<div class="search" style="max-width:100%">${icon('search')}<input id="ref-search" type="search" placeholder="Find a term or command…" aria-label="Search reference" value="${esc(refSearch)}"></div><div class="reference-layout"><nav class="ref-nav" aria-label="Reference categories">${categories.map(c=>`<button class="${refCategory===c?'active':''}" data-action="category" data-category="${esc(c)}">${esc(c)}</button>`).join('')}</nav><div id="reference-content">${referenceContent()}</div></div>`; }
function referenceContent() {
  const q=refSearch.toLowerCase();
  if (refCategory==='Key terms'&&!q) return `<div class="section-heading"><h2>Know your environment</h2><span class="meta">12 essential terms</span></div><div class="term-grid">${terms.map(([a,b])=>`<div class="term"><strong>${esc(a)}</strong><p>${esc(b)}</p></div>`).join('')}</div><p class="help-note">Pick a category to explore commands. Run host commands on your assigned node only.</p>`;
  const termResults=q ? terms.filter(t=>t.join(' ').toLowerCase().includes(q)):[];
  const results=commands.map((c,i)=>({c,i})).filter(({c})=>(q || c[0]===refCategory)&&(!q || c.join(' ').toLowerCase().includes(q)));
  return `<div class="section-heading"><h2>${q?'Search results':esc(refCategory)}</h2><span class="meta">${results.length} commands</span></div>${termResults.length ? `<div class="term-grid" style="margin-bottom:20px">${termResults.map(([a,b])=>`<div class="term"><strong>${esc(a)}</strong><p>${esc(b)}</p></div>`).join('')}</div>`:''}${results.map(({c,i})=>`<div class="command"><div><code>${esc(c[1])}</code><p>${esc(c[2])}</p></div><button class="icon-btn" data-action="copy-command" data-index="${i}" title="Copy command">${icon('copy')}</button></div>`).join('') || (!termResults.length ? empty('Nothing found.','Try “network”, “container”, or “apt”.','search'):'')}<div class="notice" style="margin-top:20px">Commands assume root on your assigned PVE host, or sudo on a guest. Replace angle-bracket placeholders before running. Review changes before confirming.</div>`;
}
function adminServerPage() { return `${heading('ADMINISTRATION','The lab, under your control.','Enroll nodes, manage access, and keep your classroom running.','<button class="btn primary" data-action="new-server">'+icon('plus')+' Enroll server</button>')}${adminServers.some(s=>s.proxyError)?'<div class="notice banner-error">One or more proxy ports could not start. Open the affected server to review its configuration and check the host’s available ports.</div>':''}${adminServers.length?`<div class="panel table-wrap"><table class="admin-table"><thead><tr><th>Hostname / IP address</th><th>Status</th><th>Access</th><th>Proxy port</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${adminServers.map(s=>`<tr><td><strong>${esc(s.hostname)}</strong><div class="mono">${esc(s.ip)}</div></td><td>${status(state.servers.find(r=>r.id===s.id)||s)}</td><td>${s.protected ? icon('lock')+' PIN protected':'Open access'}</td><td class="mono">${s.proxyPort}${s.proxyError?' ⚠':''}</td><td class="actions"><button class="icon-btn" data-action="server" data-id="${s.id}" title="View server">${icon('external')}</button><button class="icon-btn" data-action="edit-server" data-id="${s.id}" title="Edit server">${icon('edit')}</button><button class="icon-btn" data-action="delete-server" data-id="${s.id}" title="Remove server">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>`:empty('Let’s bring your first server in.','You’ll need its hostname, LAN IP address, and Proxmox login credentials.','server','<button class="btn primary" data-action="new-server">Enroll a server</button>')}<p class="help-note">Status checks contact HTTPS port 8006 from this portal host. Each enrolled server receives a dedicated proxy port. PIN and credential changes invalidate existing portal access.</p>`; }
function ticketPage() {
  const open=tickets.filter(t=>t.status==='open').length, rows=tickets.filter(t=>ticketFilter==='all'||t.status===ticketFilter);
  return `${heading('ADMINISTRATION','A helping hand, when it’s needed.','Student issue reports, all in one place.')}<div class="filter-tabs">${['open','closed','all'].map(f=>`<button data-action="ticket-filter" data-filter="${f}" class="${ticketFilter===f?'active':''}">${f[0].toUpperCase()+f.slice(1)} ${f==='open'?`(${open})`:''}</button>`).join('')}</div>${rows.length ? rows.map(t=>`<article class="ticket ${t.status}"><div class="ticket-top"><div><h3>${esc(t.subject)}</h3><div class="ticket-meta">${esc(t.server_name)} · ${esc(t.name || 'Student')} · ${new Date(t.created_at).toLocaleString()}</div></div><span class="status ${t.status==='open'?'':'checking'}">${t.status==='open'?'Open':'Closed'}</span></div><p>${esc(t.message)}</p><div class="ticket-footer"><span>Ticket ${t.id.slice(0,8)}</span><button class="btn small" data-action="ticket-status" data-id="${t.id}" data-status="${t.status==='open'?'closed':'open'}">${icon(t.status==='open'?'check':'back')}${t.status==='open'?'Close ticket':'Reopen ticket'}</button></div></article>`).join(''):empty('All quiet on this side.',`There are no ${ticketFilter==='all'?'':ticketFilter+' '}tickets to show.`,'ticket')}`;
}
function settingsPage() { return `${heading('ADMINISTRATION','Make this lab yours.','Manage the workspace name and your instructor password.')}<div class="panel settings-panel"><h2>Workspace</h2><form id="title-form"><div class="form-field"><label for="lab-title">Portal name</label><input id="lab-title" name="title" required maxlength="60" value="${esc(state.title)}"></div><div class="form-error"></div><button class="btn primary">Save name</button></form><div class="divider"></div><h2>Change administrator password</h2><form id="password-form"><div class="form-field"><label for="current-password">Current password</label><input id="current-password" name="currentPassword" type="password" required autocomplete="current-password"></div><div class="form-field"><label for="new-password">New password</label><input id="new-password" name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"><small>At least 12 characters. Other admin sessions will be signed out.</small></div><div class="form-error"></div><button class="btn primary">Update password</button></form><div class="divider"></div><h2>Connection settings</h2><p class="muted" style="font-size:12px">${state.secure?'HTTPS is enabled.':'Running over HTTP. Set TLS_CERT and TLS_KEY on the host to enable HTTPS and browser clipboard APIs across the LAN.'} Server status checks run every ${state.interval/1000} seconds. See README.md for LAN hosting, firewall ports, backups, and certificates.</p></div>`; }
async function refresh() { const value=await api('/api/bootstrap'); state={...value,live:state.live}; }
async function render() {
  const id=++renderId;
  route=location.hash.slice(1).split('?')[0] || 'overview';
  if (workspace) { renderWorkspace(); return; }
  if (route.startsWith('admin')&&!state.admin) { route='overview'; history.replaceState(null,'','#overview'); showLogin(); }
  try {
    if (route==='admin/servers') adminServers=await api('/api/admin/servers');
    if (route==='admin/tickets') tickets=await api('/api/admin/tickets');
    if (id!==renderId) return;
    app.innerHTML=shell(route==='reference'?referencePage():route==='tasks'?taskPage():route==='admin/servers'?adminServerPage():route==='admin/tickets'?ticketPage():route==='admin/tasks'?taskPage(true):route==='admin/settings'?settingsPage():overview());
    if(route==='overview') updateLiveOverview();
    document.title=`${state.title} · ${route.startsWith('admin')?'Instructor':'Student'} Portal`;
  } catch(err) { if (err.status===401) { state.admin=false; location.hash='overview'; toast('Your session expired. Please sign in again.'); } else toast(err.message); }
}
function modal(title,subtitle,content,wide=false) {
  returnFocus=document.activeElement; overlay.innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="icon-btn" data-action="close" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-content">${content}</div></section></div>`;
  document.body.style.overflow='hidden'; requestAnimationFrame(()=>(overlay.querySelector('input,textarea') || overlay.querySelector('button'))?.focus());
}
function closeModal() { overlay.innerHTML=''; document.body.style.overflow=''; returnFocus?.focus?.(); }
function showLogin() {
  const setup=state.setup;
  modal(setup?'Welcome to your lab.':'Instructor sign in',setup?'Set up your administrator account. Students don’t need an account.':'Manage your servers, tasks, and student issue reports.',setup&&!state.local&&!state.remoteSetup?'<div class="notice">Open this portal at localhost on the host computer to complete initial setup, or configure SETUP_TOKEN for remote setup.</div>':`<form id="login-form">${setup&&!state.local?'<div class="form-field"><label for="setup-token">Host setup token</label><input id="setup-token" name="token" type="password" required autocomplete="off"><small>The SETUP_TOKEN configured on the portal host.</small></div>':''}<div class="form-field"><label for="username">${setup?'Choose an admin username':'Username'}</label><input id="username" name="username" required maxlength="64" autocomplete="username" value="${setup?'admin':''}"></div><div class="form-field"><label for="login-password">${setup?'Choose a password':'Password'}</label><input id="login-password" name="password" type="password" required ${setup?'minlength="12"':''} maxlength="128" autocomplete="${setup?'new-password':'current-password'}">${setup?'<small>Use at least 12 characters. There is no default admin password.</small>':''}</div><div class="form-error"></div><button class="btn primary detail-connect">${icon('lock')}${setup?'Create administrator':'Sign in'}</button></form>`);
}
async function showServer(id) {
  try { detail=await api(`/api/servers/${id}`); showDetails(); }
  catch(err) { if (err.status!==403) return toast(err.message); const s=state.servers.find(s=>s.id===id); modal('Your server. Your space.',`Enter the PIN for ${esc(s?.hostname || 'this server')}.`,`<form id="pin-form" data-id="${id}"><div class="form-field"><label for="server-pin">Server PIN</label><input id="server-pin" name="pin" type="password" required maxlength="64" autocomplete="off" placeholder="Ask your instructor for your PIN"></div><div class="form-error"></div><button class="btn primary detail-connect">${icon('lock')} Unlock server</button></form>`); }
}
function showDetails() {
  const d=detail, current=state.servers.find(s=>s.id===d.id)||d;
  modal(esc(d.hostname),'Your assigned Proxmox VE environment.',`<div class="detail-meta">${status(current)}<span class="mono muted">${esc(d.ip)}:8006</span>${d.protected?`<span class="pill">${icon('lock')} PIN protected</span>`:''}</div><div class="credentials"><div class="credential"><span class="label">Username</span><code>${esc(d.username)}</code><button class="icon-btn" data-action="copy-username" title="Copy username">${icon('copy')}</button></div><div class="credential"><span class="label">Password</span><code id="credential-password">••••••••••••</code><button class="icon-btn" data-action="show-password" title="Show password">${icon('eye')}</button><button class="icon-btn" data-action="copy-password" title="Copy password">${icon('copy')}</button></div><div class="credential"><span class="label">Realm</span><code>Linux PAM standard authentication</code></div></div><button class="btn primary detail-connect" data-action="connect" data-id="${d.id}">${icon('external')} Connect to server</button><p class="detail-help">Opens the management interface in your lab workspace.</p>${current.status==='down'?'<div class="notice banner-error" style="margin-top:15px">This node is currently unreachable. You can retry connecting or report the issue below.</div>':''}${d.notes?`<div class="detail-section"><h3>Notes from your instructor</h3><div class="notes">${esc(d.notes)}</div></div>`:''}<div class="divider"></div><div class="section-heading" style="margin-bottom:0"><div><h3 style="font-size:12px">Need a hand?</h3><p class="muted" style="font-size:11px;margin-top:4px">Let your instructor know what’s going on.</p></div><button class="btn small ghost" data-action="report">${icon('ticket')} Report an issue</button></div>`);
}
function showReport() { modal('Let’s get it sorted.',`Report a technical issue with ${esc(detail.hostname)}.`,`<form id="ticket-form" data-id="${detail.id}"><div class="form-field"><label for="report-name">Your name <span class="muted">(optional)</span></label><input id="report-name" name="name" maxlength="80" autocomplete="name"></div><div class="form-field"><label for="report-subject">What’s the issue?</label><input id="report-subject" name="subject" required maxlength="120" placeholder="e.g. Container won’t start"></div><div class="form-field"><label for="report-message">Tell us more</label><textarea id="report-message" name="message" required maxlength="4000" rows="5" placeholder="What were you trying to do? Include any error messages."></textarea></div><div class="form-error"></div><div class="modal-actions"><button class="btn ghost" type="button" data-action="details">Back</button><button class="btn primary">${icon('ticket')} Send report</button></div></form>`); }
function serverForm(id) {
  const s=adminServers.find(s=>s.id===id);
  modal(s?'Edit lab server':'Bring a node into the lab.',s?`Update ${esc(s.hostname)}. Access grants reset when you save.`:'Enroll a Proxmox VE host on your local network.',`<form id="server-form" data-id="${id || ''}"><div class="form-grid"><div class="form-field"><label for="hostname">Hostname</label><input id="hostname" name="hostname" required maxlength="80" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*" placeholder="pve-student-01" value="${esc(s?.hostname || '')}"></div><div class="form-field"><label for="ip">Local IPv4 address</label><input id="ip" name="ip" required maxlength="15" placeholder="192.168.1.101" value="${esc(s?.ip || '')}"></div><div class="form-field"><label for="pve-username">PVE username</label><input id="pve-username" name="username" maxlength="64" value="${esc(s?.username || 'root')}" autocomplete="off"></div><div class="form-field"><label for="pve-password">PVE password ${s?'(leave blank to keep)':''}</label><input id="pve-password" name="password" type="password" maxlength="512" ${s?'':'required'} autocomplete="new-password"></div><div class="form-field"><label for="pin-action">Student access</label><select id="pin-action" name="pinAction">${s?`<option value="keep">Keep current (${s.protected?'PIN protected':'open access'})</option>`:''}<option value="remove">Open access · no PIN</option><option value="set">${s?'Set / change':'Require a'} PIN</option></select></div><div class="form-field"><label for="enroll-pin">New PIN (when setting)</label><input id="enroll-pin" name="pin" type="password" minlength="4" maxlength="64" autocomplete="new-password" placeholder="At least 4 characters"><small>Optional. Share only with the assigned student.</small></div><div class="form-field full"><label for="server-notes">Notes for this server <span class="muted">(optional)</span></label><textarea id="server-notes" name="notes" maxlength="8000" rows="4" placeholder="Assignment, network details, or helpful reminders…">${esc(s?.notes || '')}</textarea></div><label class="check-label form-field full"><span><input name="allowSelfSigned" type="checkbox" ${s?.allowSelfSigned===false?'':'checked'}> Trust this node’s self-signed PVE certificate</span></label></div>${s?.proxyError?`<div class="notice banner-error">${esc(s.proxyError)}</div>`:''}<div class="form-error"></div><div class="modal-actions"><button class="btn ghost" type="button" data-action="close">Cancel</button><button class="btn primary">${icon(s?'check':'plus')}${s?'Save changes':'Enroll server'}</button></div></form>`,true);
}
function taskForm(id) {
  const t=state.tasks.find(t=>t.id===id);
  modal(t?'Edit lab task':'A new thing to learn.',t?'Changes will reset this task’s student checkboxes.':'Give students a clear objective and a useful starting point.',`<form id="task-form" data-id="${id||''}"><div class="form-field"><label for="task-title">Task title</label><input id="task-title" name="title" required maxlength="160" value="${esc(t?.title || '')}" placeholder="Create your first Linux container"></div><div class="form-field"><label for="task-description">Instructions</label><textarea id="task-description" name="description" rows="6" maxlength="6000" placeholder="Describe the objective and what a successful result looks like.">${esc(t?.description || '')}</textarea></div><div class="form-field"><label for="task-position">Order (smaller numbers appear first)</label><input id="task-position" type="number" name="position" step="1" value="${t?.position ?? state.tasks.length}"></div><div class="form-error"></div><div class="modal-actions"><button class="btn ghost" type="button" data-action="close">Cancel</button><button class="btn primary">Save task</button></div></form>`);
}
function confirmModal(title,description,action,id) { modal(title,description,`<div class="form-error"></div><div class="modal-actions"><button class="btn ghost" data-action="close">Cancel</button><button class="btn danger" data-action="${action}" data-id="${id}">${icon('trash')} Remove</button></div>`); }
async function copy(value) {
  try { if (navigator.clipboard&&window.isSecureContext) await navigator.clipboard.writeText(value); else { const input=document.createElement('textarea'); input.value=value; input.style.position='fixed'; input.style.opacity='0'; (overlay.querySelector('.modal-content') || document.body).append(input); input.select(); if (!document.execCommand('copy')) throw Error('Clipboard unavailable. Select the text and use Ctrl+C.'); input.remove(); } toast('Copied to clipboard.'); }
  catch(err) { toast(err.message || 'Select the text and copy it manually.'); }
}
function renderWorkspace() {
  const d=workspace;
  app.innerHTML=`<section class="workspace"><header class="workspace-bar"><div class="workspace-left"><button class="icon-btn" data-action="exit-workspace" title="Exit workspace">${icon('back')}</button><strong>${esc(d.hostname)}</strong><span class="mono">${esc(d.ip)}:8006</span><span id="workspace-status">${status(state.servers.find(s=>s.id===d.id)||d)}</span></div><div class="workspace-right"><a class="btn ghost" href="/#reference" target="_blank" rel="noopener">${icon('book')}<span class="workspace-label">Reference</span>${icon('external')}</a><button class="btn ghost" data-action="workspace-tasks">${icon('tasks')} Tasks</button><button class="icon-btn" data-action="workspace-help" title="Console and clipboard help">${icon('info')}</button></div></header><div class="workspace-hint" id="workspace-hint"><span>For host and LXC terminals, use xterm.js and Ctrl+Shift+C / Ctrl+Shift+V. ${state.secure?'Allow clipboard access when prompted.':'Enable HTTPS for full browser clipboard access on the LAN.'}</span><button data-action="dismiss-hint" aria-label="Dismiss clipboard hint">✕</button></div><iframe title="Proxmox VE management for ${esc(d.hostname)}" src="${esc(d.url)}" allow="clipboard-read; clipboard-write; fullscreen" referrerpolicy="no-referrer" allowfullscreen></iframe><div id="workspace-drawer"></div></section>`;
}
async function connect(id,button) {
  button.disabled=true;
  try { const info=await api(`/api/servers/${id}/connect`,'POST',{}); const url=new URL(location.origin); url.port=info.port; workspace={...detail,url:url.origin}; closeModal(); renderWorkspace(); }
  catch(err) { toast(err.message); button.disabled=false; }
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]'); if(!button) return;
  const action=button.dataset.action,id=button.dataset.id;
  try {
    if(action==='close') closeModal();
    if(action==='login') showLogin();
    if(action==='logout') { detail=null; closeModal(); await api('/api/logout','POST',{}); state.admin=false; location.hash='overview'; await render(); toast('Signed out.'); }
    if(action==='server') await showServer(id);
    if(action==='details') showDetails();
    if(action==='report') showReport();
    if(action==='copy-username') copy(detail.username);
    if(action==='copy-password') copy(detail.password);
    if(action==='show-password') { const el=$('#credential-password'); const shown=el.dataset.shown==='true'; el.textContent=shown?'••••••••••••':detail.password; el.dataset.shown=String(!shown); button.title=shown?'Show password':'Hide password'; }
    if(action==='connect') await connect(id,button);
    if(action==='new-server') serverForm();
    if(action==='edit-server') serverForm(id);
    if(action==='delete-server') confirmModal('Remove this server?','The server is removed from the portal. Existing tickets are retained. The PVE host itself is not changed.','confirm-delete-server',id);
    if(action==='confirm-delete-server') { await api(`/api/admin/servers/${id}`,'DELETE',{}); closeModal(); await refresh(); await render(); toast('Server removed.'); }
    if(action==='new-task') taskForm();
    if(action==='edit-task') taskForm(id);
    if(action==='delete-task') confirmModal('Remove this task?','This removes the task from the classroom list.','confirm-delete-task',id);
    if(action==='confirm-delete-task') { await api(`/api/admin/tasks/${id}`,'DELETE',{}); closeModal(); await refresh(); await render(); toast('Task removed.'); }
    if(action==='category') { refCategory=button.dataset.category; refSearch=''; $('#ref-search').value=''; document.querySelectorAll('.ref-nav button').forEach(b=>b.classList.toggle('active',b===button)); $('#reference-content').innerHTML=referenceContent(); }
    if(action==='copy-command') copy(commands[+button.dataset.index][1]);
    if(action==='ticket-filter') { ticketFilter=button.dataset.filter; await render(); }
    if(action==='ticket-status') { await api(`/api/admin/tickets/${id}`,'PATCH',{status:button.dataset.status}); await render(); toast('Ticket updated.'); }
    if(action==='exit-workspace') { workspace=null; await refresh(); await render(); }
    if(action==='dismiss-hint') $('#workspace-hint')?.remove();
    if(action==='workspace-tasks') { const drawer=$('#workspace-drawer'); if(drawer.innerHTML) drawer.innerHTML=''; else { await refresh(); drawer.innerHTML=`<aside class="workspace-drawer panel"><div class="panel-head"><h2>Your lab tasks</h2><button class="icon-btn" data-action="workspace-tasks" aria-label="Close task drawer">${icon('close')}</button></div><div class="panel-body" id="mini-tasks">${miniTasks(true)}</div><div class="panel-footer">Progress saved in this browser</div></aside>`; } }
    if(action==='workspace-help') modal('Working in the console.','A few things that make the lab smoother.',`<div class="notes">Host shells and LXC consoles: choose xterm.js in Proxmox’s console menu. Use Ctrl+Shift+C to copy a selection and Ctrl+Shift+V to paste (Cmd+C / Cmd+V on macOS). Browser permissions may require HTTPS and a trusted certificate.

VM graphical consoles: noVNC clipboard depends on guest support. Use the noVNC clipboard panel where available, or configure a serial terminal and use xterm.js for text work. The portal forwards terminal WebSockets without modifying input.

If the management frame does not load, confirm that the portal’s proxy port is allowed through the host firewall. Sign in to Proxmox using the credentials on the server detail page.</div><div class="modal-actions"><button class="btn primary" data-action="close">Got it</button></div>`);
  } catch(err) { const error=overlay.querySelector('.form-error'); if(error) error.textContent=err.message; else toast(err.message); }
});
document.addEventListener('input',event=>{
  if(event.target.id==='server-search') { filter=event.target.value; $('#server-list').innerHTML=serverList(); }
  if(event.target.id==='ref-search') { refSearch=event.target.value; $('#reference-content').innerHTML=referenceContent(); }
});
document.addEventListener('change',event=>{
  if(event.target.id==='status-filter') { statusFilter=event.target.value; $('#server-list').innerHTML=serverList(); }
  if(event.target.dataset.task) {
    const task=state.tasks.find(t=>t.id===event.target.dataset.task); if(!task) return;
    if(event.target.checked) completed[task.id]=task.revision; else delete completed[task.id];
    try { localStorage.setItem('lab-task-progress',JSON.stringify(completed)); } catch { toast('Browser storage is unavailable; progress lasts for this visit.'); }
    if(workspace) $('#mini-tasks').innerHTML=miniTasks(true); else if(route==='tasks') render(); else if($('#mini-tasks')) { $('#mini-tasks').innerHTML=miniTasks(); const count=document.querySelector('a[href="#tasks"] .count'); if(count) count.textContent=`${progress()}/${state.tasks.length}`; }
  }
});
document.addEventListener('submit',async event=>{
  const form=event.target; if(!['login-form','pin-form','server-form','ticket-form','task-form','title-form','password-form'].includes(form.id)) return;
  event.preventDefault(); const data=Object.fromEntries(new FormData(form)),button=form.querySelector('button[type="submit"],button:not([type])'); const error=form.querySelector('.form-error'); error.textContent=''; button.disabled=true;
  try {
    if(form.id==='login-form') { await api(state.setup?'/api/setup':'/api/login','POST',data); closeModal(); await refresh(); location.hash='admin/servers'; await render(); toast('Welcome to the instructor workspace.'); }
    if(form.id==='pin-form') { await api(`/api/servers/${form.dataset.id}/unlock`,'POST',data); await showServer(form.dataset.id); }
    if(form.id==='server-form') { data.allowSelfSigned=form.elements.allowSelfSigned.checked; await api('/api/admin/servers'+(form.dataset.id?'/'+form.dataset.id:''),form.dataset.id?'PUT':'POST',data); closeModal(); await refresh(); await render(); toast('Server saved. Live status checking has started.'); }
    if(form.id==='ticket-form') { const result=await api(`/api/servers/${form.dataset.id}/tickets`,'POST',data); modal('Your report is on its way.',`Ticket ${result.id.slice(0,8)} · ${esc(detail.hostname)}`,`<div class="notes">Your instructor can now see your issue in the ticket queue.</div><div class="modal-actions"><button class="btn primary" data-action="close">Done</button></div>`); }
    if(form.id==='task-form') { data.position=Number(data.position); await api('/api/admin/tasks'+(form.dataset.id?'/'+form.dataset.id:''),form.dataset.id?'PUT':'POST',data); closeModal(); await refresh(); await render(); toast('Task saved.'); }
    if(form.id==='title-form'||form.id==='password-form') { await api('/api/admin/settings','PUT',data); await refresh(); await render(); toast('Settings updated.'); }
  } catch(err) { error.textContent=err.message; }
  finally { button.disabled=false; }
});
overlay.addEventListener('click',event=>{if(event.target.classList.contains('modal-backdrop')) closeModal();});
document.addEventListener('keydown',event=>{
  if(!overlay.innerHTML) return;
  if(event.key==='Escape') closeModal();
  if(event.key==='Tab') { const focusable=[...overlay.querySelectorAll('button,a,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled); const first=focusable[0],last=focusable.at(-1); if(event.shiftKey&&document.activeElement===first) { event.preventDefault(); last.focus(); } else if(!event.shiftKey&&document.activeElement===last) { event.preventDefault(); first.focus(); } }
});
window.addEventListener('hashchange',()=>{closeModal();render();});
let updatesQueued=false;
const events=new EventSource('/api/events');
events.onopen=()=>{state.live=true; const label=$('#live-label'); if(label) label.textContent='Lab feed connected'; const dot=document.querySelector('.network-tag .dot'); dot?.classList.remove('off');};
events.onerror=()=>{state.live=false; const label=$('#live-label'); if(label) label.textContent='Reconnecting to lab…'; document.querySelector('.network-tag .dot')?.classList.add('off');};
events.onmessage=event=>{
  try { state.servers=JSON.parse(event.data); } catch { return; }
  if(updatesQueued) return; updatesQueued=true;
  requestAnimationFrame(()=>{updatesQueued=false; if(!workspace&&route==='overview') updateLiveOverview(); document.querySelectorAll('[data-node-status]').forEach(el=>{const row=state.servers.find(s=>s.id===el.dataset.nodeStatus);if(row){el.className=`status ${row.status}`;const label=row.status==='up'?'● Up':row.status==='down'?'● Down':'◌ Checking';if(el.textContent!==label)el.textContent=label;}}); });
};
// Refresh shared tasks and tickets without replacing an active form or terminal.
setInterval(async()=>{if(document.hidden || overlay.innerHTML) return; try { const previous=JSON.stringify(state.tasks),wasAdmin=state.admin,wasSetup=state.setup; await refresh(); if(!workspace&&(wasAdmin!==state.admin||wasSetup!==state.setup||previous!==JSON.stringify(state.tasks)||route==='admin/tickets')) await render(); } catch {}},15000);
try { await refresh(); await render(); } catch(err) { app.innerHTML='<div class="boot">Could not reach the lab portal. Reload to try again.</div>'; }
