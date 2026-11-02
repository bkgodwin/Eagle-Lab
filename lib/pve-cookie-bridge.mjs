// Proxmox sets/clears its session cookie in JavaScript with Secure=true.
// HTTP LAN origins reject that cookie even when upstream Set-Cookie headers are rewritten.
// Scope this compatibility layer to this node's PVE cookie; leave all other cookies alone.
export function cookieBridgeSource(cookieName, secure) {
  return `(() => {
    const name = ${JSON.stringify(cookieName)};
    const secure = ${JSON.stringify(secure)};
    let proto = Document.prototype, descriptor;
    while (proto && !(descriptor = Object.getOwnPropertyDescriptor(proto, 'cookie'))) proto = Object.getPrototypeOf(proto);
    if (!descriptor || !descriptor.get || !descriptor.set) throw new Error('PVE cookie compatibility is unavailable in this browser.');
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() { return descriptor.get.call(this); },
      set(value) {
        const parts = String(value).split(';');
        const split = parts[0].indexOf('=');
        const key = parts[0].slice(0, split).trim();
        if (split >= 0 && (key === name || key === 'PVEAuthCookie')) {
          parts[0] = name + parts[0].slice(split);
          const attributes = parts.slice(1).filter(part => {
            const attr = part.trim().split('=')[0].toLowerCase();
            return attr !== 'domain' && attr !== 'path' && (secure || attr !== 'secure');
          }).map(part => !secure && /^\\s*samesite\\s*=\\s*none\\s*$/i.test(part) ? ' SameSite=Lax' : part);
          value = [parts[0], ...attributes, ' Path=/'].join(';');
        }
        descriptor.set.call(this, value);
      }
    });
  })();`;
}
