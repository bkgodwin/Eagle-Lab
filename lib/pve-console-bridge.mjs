// PVE's patched noVNC defaults to encrypted WebSockets even on an HTTP page.
// The browser-facing scheme must match this proxy's listener; upstream remains HTTPS.
export function consoleBridgeSource() {
  return `(() => {
    if (location.protocol !== 'http:' || !window.WebSocket) return;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class EaglePveWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        const target = new URL(url, location.href);
        if (target.protocol === 'wss:' && target.host === location.host &&
            /^\\/api2\\/(?:json|extjs)\\/.*\\/(?:vncwebsocket|termwebsocket)$/.test(target.pathname)) {
          target.protocol = 'ws:';
          url = target.href;
        }
        if (protocols === undefined) super(url); else super(url, protocols);
      }
    };
  })();`;
}
