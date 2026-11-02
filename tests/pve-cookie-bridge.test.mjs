import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { cookieBridgeSource } from '../lib/pve-cookie-bridge.mjs';

function browser(secure) {
  let lastWrite='',value='';
  class Document {
    get cookie() { return value; }
    set cookie(input) {
      lastWrite=input;
      // Browsers reject Secure cookies set from an ordinary HTTP LAN origin.
      if (!secure && /;\s*secure(?:;|$)/i.test(input)) return;
      value=/expires=Thu, 01 Jan 1970/i.test(input) ? '' : input.split(';')[0];
    }
  }
  const document=new Document();
  return { Document,document,lastWrite:()=>lastWrite };
}
test('Reproduces and fixes browser-written Secure PVE cookie rejection on HTTP LAN origins',()=>{
  const context=browser(false),name='PVEAuthCookie_testnode';
  context.document.cookie=`${name}=ticket; Path=/; Secure; SameSite=Lax`;
  assert.equal(context.document.cookie,''); // old proxy behavior
  vm.runInNewContext(cookieBridgeSource(name,false),context);
  context.document.cookie=`${name}=ticket; Path=/; Secure; SameSite=Lax`;
  assert.equal(context.document.cookie,`${name}=ticket`);
  assert.ok(!/;\s*secure(?:;|$)/i.test(context.lastWrite()));
  context.document.cookie=`${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure`;
  assert.equal(context.document.cookie,''); // logout must also work
});
test('HTTPS PVE cookies retain Secure and unrelated cookies are untouched',()=>{
  const context=browser(true),name='PVEAuthCookie_testnode';
  vm.runInNewContext(cookieBridgeSource(name,true),context);
  context.document.cookie='PVEAuthCookie=ticket; Domain=upstream.example; Path=/console; Secure; SameSite=Lax';
  assert.equal(context.document.cookie,`${name}=ticket`);
  assert.ok(context.lastWrite().includes('Secure'));assert.ok(!context.lastWrite().includes('Domain='));
  assert.ok(context.lastWrite().endsWith('Path=/'));
  context.document.cookie='PVELang=en; Secure; Path=/';
  assert.equal(context.lastWrite(),'PVELang=en; Secure; Path=/');
});
