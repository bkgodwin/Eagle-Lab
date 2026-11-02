import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { hash, verify, seal, unseal, grantToken, validGrant, validAddress } from '../lib/security.mjs';

test('Passwords and PINs use salted scrypt hashes',()=>{
  const stored=hash('student-pin'); assert.notEqual(stored,hash('student-pin'));
  assert.equal(verify('student-pin',stored),true); assert.equal(verify('wrong',stored),false); assert.equal(verify('anything','corrupt'),false);
});
test('Stored PVE passwords are encrypted and authenticated',()=>{
  const key=randomBytes(32), value=seal('test-password',key);
  assert.equal(unseal(value,key),'test-password'); assert.ok(!value.includes('test-password'));
  assert.throws(()=>unseal(value,randomBytes(32)));
  const bytes=Buffer.from(value,'base64'); bytes[15]^=1; assert.throws(()=>unseal(bytes.toString('base64'),key));
});
test('Access grants reject tampering, expiry, other nodes, and changed PIN revisions',()=>{
  const row={id:'abc',revision:1},key=randomBytes(32),token=grantToken(row,key);
  assert.equal(validGrant(token,row,key),true);
  assert.equal(validGrant(token,{...row,revision:2},key),false);
  assert.equal(validGrant(token,{...row,id:'other'},key),false);
  assert.equal(validGrant(grantToken(row,key,Date.now()-1),row,key),false);
  assert.equal(validGrant(token+'x',row,key),false);
  assert.equal(validGrant(token+'.extra',row,key),false);
});
test('Only literal private LAN IPv4 targets may be enrolled',()=>{
  for(const ip of ['10.0.0.1','172.16.0.1','172.31.255.254','192.168.1.1']) assert.ok(validAddress(ip));
  for(const ip of ['127.0.0.1','169.254.169.254','8.8.8.8','172.32.0.1','localhost','192.168.1.1/path','::1','10.0.0.999']) assert.equal(validAddress(ip),false);
});
