import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {consoleBridgeSource} from '../lib/pve-console-bridge.mjs';
function browser(protocol='http:'){
  const calls=[];
  class Socket { static OPEN=1;constructor(...args){calls.push(args);} }
  const window={WebSocket:Socket};
  const location={protocol,host:'lab.local:8100',href:`${protocol}//lab.local:8100/?console=kvm&novnc=1`};
  vm.runInNewContext(consoleBridgeSource(),{window,location,URL});
  return {window,calls,Socket};
}
test('Nested noVNC consoles use ws on an HTTP proxy and preserve the binary subprotocol and ticket',()=>{
  const {window,calls,Socket}=browser();
  const path='/api2/json/nodes/pve/qemu/100/vncwebsocket?port=5900&vncticket=PVEVNC%3Atest%2Bticket%3D';
  const socket=new window.WebSocket('wss://lab.local:8100'+path,['binary']);
  assert.equal(calls[0][0],'ws://lab.local:8100'+path);assert.deepEqual(calls[0][1],['binary']);
  assert.ok(socket instanceof Socket);assert.equal(window.WebSocket.OPEN,1);
});
test('Console bridge does not downgrade HTTPS, other hosts, or unrelated WebSockets',()=>{
  const secure=browser('https:');new secure.window.WebSocket('wss://lab.local:8100/api2/json/nodes/pve/vncwebsocket','binary');
  assert.equal(secure.calls[0][0],'wss://lab.local:8100/api2/json/nodes/pve/vncwebsocket');
  const plain=browser();new plain.window.WebSocket('wss://other.local:8100/api2/json/nodes/pve/vncwebsocket');new plain.window.WebSocket('wss://lab.local:8100/other');
  assert.equal(plain.calls[0][0],'wss://other.local:8100/api2/json/nodes/pve/vncwebsocket');assert.equal(plain.calls[1][0],'wss://lab.local:8100/other');
});
