import { terms,commands } from './reference.js';
const view=document.getElementById('view'),connection=document.getElementById('connection');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let data={servers:[],tasks:[]},page='servers',search='',category='Key terms',stopped=false,pending=false,timer,controller;
const categories=['Key terms',...new Set(commands.map(command=>command[0]))];
function renderBody(){
  const target=document.getElementById('items');
  if(page==='servers'){
    const rows=data.servers.filter(row=>(row.hostname+' '+row.ip).toLowerCase().includes(search.toLowerCase()));
    target.innerHTML=rows.map(row=>`<article class="server ${esc(row.status)}"><div><h3>${esc(row.hostname)}${row.protected?'<span class="lock">PIN protected in full portal</span>':''}</h3><p class="ip">${esc(row.ip)}:8006</p></div><span class="state">${row.status==='up'?'● Up':row.status==='down'?'● Down':'◌ Checking'}</span></article>`).join('')||'<p class="empty">No matching lab servers.</p>';
  }else if(page==='tasks'){
    target.innerHTML=data.tasks.map((task,index)=>`<article class="card"><p class="task-number">TASK ${String(index+1).padStart(2,'0')}</p><h3>${esc(task.title)}</h3><p>${esc(task.description)}</p></article>`).join('')||'<p class="empty">Your instructor has not posted any tasks.</p>';
  }else{
    const query=search.toLowerCase(),showTerms=category==='Key terms'||query;
    const foundTerms=showTerms?terms.filter(term=>!query||term.join(' ').toLowerCase().includes(query)):[];
    const found=commands.map((command,index)=>({command,index})).filter(({command})=>query?command.join(' ').toLowerCase().includes(query):command[0]===category);
    target.innerHTML=(foundTerms.length?`<div class="terms">${foundTerms.map(([name,description])=>`<article class="card"><strong>${esc(name)}</strong><p>${esc(description)}</p></article>`).join('')}</div>`:'')+found.map(({command,index})=>`<article class="card command"><div><code>${esc(command[1])}</code><p>${esc(command[2])}</p></div><button class="copy" data-copy="${index}">Copy</button></article>`).join('')||'<p class="empty">No matching commands or terms.</p>';
  }
}
function render(){
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===page)));
  view.innerHTML=`<h2>${page==='servers'?'Lab servers':page==='tasks'?'Lab tasks':'Command reference'}</h2>${page!=='tasks'?`<div class="toolbar"><input id="search" type="search" aria-label="Search ${page}" placeholder="${page==='servers'?'Search hostname or IP…':'Find a command or term…'}" value="${esc(search)}">${page==='reference'?`<select id="category" aria-label="Reference category">${categories.map(name=>`<option ${name===category?'selected':''}>${esc(name)}</option>`).join('')}</select>`:''}</div>`:''}<p id="copy-message" role="status"></p><div id="items"></div>`;
  renderBody();
}
async function refresh(){
  if(stopped||pending||document.hidden)return;
  pending=true;controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch('data',{credentials:'omit',cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('Classroom data is temporarily unavailable.');
    const next=await response.json();if(stopped)return;
    if(!Array.isArray(next.servers)||!Array.isArray(next.tasks))throw new Error('Unexpected classroom response.');
    data=next;document.getElementById('portal-url').value=next.portalUrl||'Ask your instructor for the lab address.';
    connection.textContent=`${data.servers.length} servers · ${data.servers.filter(row=>row.status==='up').length} up · Updated ${new Date().toLocaleTimeString()}`;connection.className='';
    if(page!=='reference')renderBody();
  }catch(error){if(!stopped){connection.textContent='Connection unavailable. Retrying shortly…';connection.className='error';}}
  finally{clearTimeout(deadline);pending=false;}
}
document.addEventListener('click',event=>{
  const nav=event.target.closest('[data-view]');if(nav){page=nav.dataset.view;search='';render();return;}
  const button=event.target.closest('[data-copy]');if(!button)return;
  const input=document.createElement('textarea');input.value=commands[+button.dataset.copy][1];input.setAttribute('aria-label','Command to copy');view.append(input);input.select();
  let copied=false;try{copied=document.execCommand('copy');}catch{}
  document.getElementById('copy-message').textContent=copied?'Command copied.':'Select the command below and press Ctrl+C / Cmd+C.';
  if(copied)input.remove();
});
document.addEventListener('input',event=>{if(event.target.id==='search'){search=event.target.value;renderBody();}});
document.addEventListener('change',event=>{if(event.target.id==='category'){category=event.target.value;renderBody();}});
document.getElementById('portal-url').addEventListener('click',event=>event.target.select());
window.addEventListener('pagehide',()=>{stopped=true;clearInterval(timer);controller?.abort();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
render();refresh();timer=setInterval(refresh,5000+Math.floor(Math.random()*500));
