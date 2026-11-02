# Eagle-Lab

A local, dark-mode classroom portal for Proxmox VE. Students can browse servers without an account. An optional per-server PIN unlocks credentials, instructor notes, issue reporting, and the embedded management workspace.

## Ubuntu LXC hosting (recommended)

Use a standard **Ubuntu 22.04 or 24.04 LXC**, x86-64 or ARM64, with outbound Internet access during installation and LAN access to the PVE nodes. A normal unprivileged container works; Docker and nesting are not required. Allocate a practical starting point of 1 vCPU, 512 MB–1 GB RAM, and space for the operating system and Node runtime.

Clone or copy this repository into `/opt/eagle-lab` inside the container. If Git is missing, install it with `apt-get update && apt-get install -y git`. For this private repository, authenticate Git normally or transfer a downloaded source archive.

```sh
cd /opt/eagle-lab
chmod +x start.sh
./start.sh
```

`start.sh` installs missing `ca-certificates`, `curl`, `xz-utils`, `coreutils`, and `tar` via apt (root or sudo required when packages are missing). It reuses a compatible Node.js 24+ installation, or downloads the latest official **Node.js 24** binary and verifies its SHA-256 checksum before installing it into `.runtime/node`. No global Node replacement, npm install, compilation, or external application packages are needed. Later launches work offline once dependencies are installed.

Open **http://CONTAINER-IP:3000**. On first launch, the console prints a generated **remote setup token**. Click **Instructor sign in**, enter that token, and create your admin account. The token is also stored in `data/setup-token.txt` with owner-only permissions and removed when setup succeeds. It is never sent through the public API. The script does not create a default administrator password.

For persistent hosting with automatic boot and crash restart:

```sh
sudo ./start.sh --install-service
sudo systemctl status eagle-lab
sudo journalctl -u eagle-lab -n 30 --no-pager
```

Run this from `/opt/eagle-lab`, not `/root` or `/home`. The installer creates an unprivileged `eagle-lab` service user, owns the data directory with that user, and registers `eagle-lab.service`. It does not change firewalls, PVE hosts, or container privileges. Stop an existing foreground process before installing the service so port 3000 is available.

Optional configuration:

```sh
cp .env.example .env
# Edit .env for HTTPS, port changes, or your own SETUP_TOKEN.
./start.sh --check                 # Install/check dependencies without starting the server
sudo systemctl restart eagle-lab   # Apply .env or source changes to an installed service
```

`start.sh` loads `.env` through Node's environment-file parser; it does not execute it as shell code. Existing shell/systemd environment variables take precedence. For custom TLS files, ensure the `eagle-lab` service user can read the certificate and key. Keep data in the default project `data` directory for the managed service; a custom `DATA_DIR` must be separately provisioned with service-user ownership.

Allow **TCP 3000 and 8100–8199** to the container from the student subnet, and **TCP 8006** from the container to the PVE nodes. Use a fixed container IP or DHCP reservation. TLS is recommended for LAN credentials and full browser clipboard APIs; see HTTPS instructions below. Node downloads use [official Node.js releases](https://nodejs.org/en/download/archive/v24).

## Start on this computer

Requires **Node.js 24 or newer**. No dependency installation or build step is required.

```powershell
node server.mjs
```

Or run `Start-Portal.ps1` from PowerShell. Open **http://localhost:3000** and select **Set up administrator**. Choose your own admin username and a password of at least 12 characters. There are no default admin credentials. Add servers from **Manage servers → Enroll server**.

Students open `http://YOUR-PORTAL-HOST-IP:3000` from the LAN. Keep the process running while the lab is in use. Application code and frontend files are read at startup; restart after changing source files.

## What is included

- A searchable server list with hostname, LAN IPv4 address, and Up/Down state. Reachable nodes have a green outline; unreachable nodes have a red outline.
- Shared Server-Sent Events status feed. The portal schedules checks of each host’s HTTPS management endpoint on port 8006 every five seconds, with a configurable five-second deadline and bounded concurrency. “Up” means the management endpoint responds with HTTP 2xx–4xx; it does not indicate guest health or successful root authentication. The server details and admin table show the last probe result, including certificate, route, refusal, timeout, or HTTP errors.
- Server details with default username `root`, password reveal/copy, notes, and Connect.
- Optional PINs, independently hashed per server. The admin can set, change, or remove a PIN at any time. Server edits reset unlock grants and close active proxied connections.
- A full-screen management iframe with a thin exit/reference/tasks bar, a dismissible clipboard hint, and a task drawer. Reference opens in a separate tab.
- Instructor login, server enrollment/edit/removal, task creation/editing/ordering/removal, and open/closed issue tickets with reopening.
- Key terms and searchable command reference for files, apt and updates, networking, LXC, VMs, storage, and troubleshooting.
- Student task checkboxes saved locally in that browser. There is no student identity or central grading; editing a task resets its checkbox version.
- SQLite persistence, encrypted PVE passwords, hashed admin passwords and PINs, HttpOnly cookies, mutation origin checks, bounded requests, and login/PIN/report rate limits.

## EagleIDE external-tool integration

Register the dedicated **read-only adapter**, rather than the full portal:

```text
Backend URL: http://EAGLE-LAB-LXC-IP:3000/eagleide/
Launch path: /eagle-lab/
HTTP methods: GET and HEAD only
Send data to app server: off
Forms, popups, dialogs, and account cloud storage: off
```

Keep the trailing slash on `/eagleide/`. Use your HTTPS backend URL instead if Eagle-Lab has TLS configured. In EagleIDE, save/retest the tool, verify the private preview, and approve it using the existing admin workflow. The Eagle-Lab container must already be allowed by EagleIDE's application-network policy; use a narrow application address/subnet rather than enabling a broad management network. No EagleIDE source or live configuration was changed by this update.

The adapter provides a searchable public server list, task instructions, key terms, and Linux/PVE command reference. It uses prefix-relative HTML/CSS/JS resources and finite JSON polling, and requires no cookies, login, browser storage, forms, SSE, WebSockets, nested frames, or server-write permission. It never returns PVE passwords, per-server notes, PIN hashes, or admin controls. Set `PUBLIC_URL=http://YOUR-LAB-HOST:3000/` in `.env` to display the browser-accessible full portal address, especially when EagleIDE reaches the backend using an internal address or alias. Students can copy that address into a separate tab for PVE access.

**Nested PVE management/console frames cannot run inside EagleIDE's existing external-tool profile.** EagleIDE enforces an opaque-origin sandbox and `frame-src 'none'`, rejects cookie/login flows, and does not proxy WebSocket upgrades or SSE. A child application cannot relax its parent's CSP or sandbox. Opening a popup from the tool also inherits those restrictions. The full portal remains protected against unrelated embedding and is intentionally separate from the adapter.

This compatibility boundary was checked against [EagleIDE's gateway](https://github.com/bkgodwin/EagleIDE/blob/main/external_tools.py), [tool workspace](https://github.com/bkgodwin/EagleIDE/blob/main/static/js/external-tools.js), and [integration guide](https://github.com/bkgodwin/EagleIDE/blob/main/static/docs/external-tools.html). A browser contract fixture exercises the adapter under the same opaque sandbox and prefix-only policy, without changing a real EagleIDE deployment.

## LAN ports and proxy architecture

The portal uses **TCP 3000** by default. Each enrolled node is assigned a dedicated **TCP proxy port in 8100–8199**. The first node uses 8100, the next uses 8101, and so on. Assignments persist across restarts and are visible in the admin table.

Allow students to reach the portal host on these ports. Allow the portal host to reach each PVE server on **HTTPS 8006**. Firewall changes are intentionally left to the host administrator; the app does not change firewall or network settings.

The iframe connects to the *portal host’s* assigned proxy port, which forwards HTTPS to the enrolled PVE address at port 8006. Separate origins preserve Proxmox’s root-relative resource/API URLs and WebSockets, and keep each server’s browser storage separate. PVE authentication cookies are also namespaced per server because cookies are shared between ports on the same hostname. Only the current server’s PVE cookie is forwarded upstream. Portal cookies are never sent to PVE.

The proxy permits embedding from the portal’s own origin, forwards WebSocket binary data without modification, and adjusts upstream frame headers. Upstream self-signed certificates are trusted by default per node, matching ordinary PVE installations. Uncheck that option when using certificates trusted by Node.js; use `NODE_EXTRA_CA_CERTS` for your school’s CA if needed.

Use the same portal hostname consistently. Links and proxy URLs use the hostname the student opened, so `localhost` is for the portal host only. Arbitrary hostnames, public IPs, link-local addresses, and loopback IPs cannot be enrolled as targets; use private IPv4 addresses in 10/8, 172.16/12, or 192.168/16.

## HTTPS and terminal clipboard

For the intended LAN clipboard experience, serve **both the portal and its node proxy ports over HTTPS with a certificate students’ browsers trust**. The application uses the same certificate on every listener. Configure your school’s trusted certificate and private key:

```powershell
$env:TLS_CERT = 'C:\path\to\lab-certificate.pem'
$env:TLS_KEY = 'C:\path\to\lab-private-key.pem'
node server.mjs
```

On Linux:

```sh
TLS_CERT=/etc/pve-lab/cert.pem TLS_KEY=/etc/pve-lab/key.pem node server.mjs
```

Then use `https://YOUR-CERTIFICATE-HOSTNAME:3000`. The certificate must cover the hostname or IP students actually use. Provision browser trust through your normal school certificate process. A self-signed certificate that the browser does not trust is insufficient for reliable clipboard APIs. The PEM files in `tests/fixtures` are public test-only credentials and must never be used for hosting.

For **host shells and LXC text consoles**, choose **xterm.js** in Proxmox’s console menu. Use **Ctrl+Shift+C / Ctrl+Shift+V**, or **Cmd+C / Cmd+V** on macOS, and grant clipboard access if the browser requests it. The iframe explicitly allows clipboard read/write and fullscreen. The portal does not intercept terminal keystrokes or execute pasted commands.

For **VM graphical consoles**, copy/paste depends on Proxmox/noVNC and guest configuration. Use the noVNC clipboard panel when supported. For a reliable text workflow, configure a VM serial console and use xterm.js, or use SSH. Merely placing a graphical console in an iframe cannot add clipboard integration to a guest that lacks it.

### Nested VM console transport

In the full standalone Eagle-Lab workspace, PVE's VM Console tab creates another iframe within the proxied management iframe. The proxy's frame policy permits both the portal origin and the node proxy's own origin, so that ancestor chain is supported.

Proxmox's patched noVNC defaults to encrypted WebSockets (`encrypt=true`) even on an HTTP page. That can make an HTTP Eagle-Lab node port receive an incompatible `wss://` connection. The compatibility script now corrects **only same-node PVE VNC/terminal WebSocket URLs on an HTTP page** to use `ws://`. HTTPS pages, other hosts, and unrelated WebSocket paths are unchanged; upstream traffic to PVE remains HTTPS. VNC ticket query strings, the PVE session cookie, and the `binary` WebSocket subprotocol are preserved. Upgrade rejection statuses are returned accurately instead of becoming an unexplained 502. This is based on [Proxmox's noVNC patch](https://git.proxmox.com/?p=novnc-pve.git;a=blob;f=debian/patches/0001-add-PVE-specific-JS-code.patch;hb=HEAD).

After updating, restart Eagle-Lab and reload/reopen the management frame and console. The browser fixture verifies portal → management frame → nested console → binary WebSocket → RFB greeting using a synthetic PVE endpoint. Real guest display and authentication still require verification against the deployed PVE node. This change cannot override EagleIDE's outer `frame-src 'none'` policy.

HTTP works for basic local use and manual copy fallback, but browser clipboard APIs on a LAN address usually require HTTPS. Browser behavior varies; real PVE console interaction needs a check with your deployed PVE version and students’ browsers.

### Connection error 401 / server appears offline

These are separate checks. The portal must be able to contact PVE from **inside its hosting LXC**; your laptop reaching PVE does not prove that the LXC has the same routing or firewall access.

Earlier versions did not account for Proxmox setting its login cookie with `Secure` in browser JavaScript. On an ordinary HTTP LAN address, the browser rejects that cookie and subsequent PVE API calls receive 401. The proxy now injects a node-specific cookie compatibility script before the PVE page scripts. It handles login, renewal, and logout for that PVE cookie, keeps cookies namespaced, and preserves `Secure` when the portal uses HTTPS. Upstream connections to PVE always use HTTPS. No passwords or PVE authentication checks are bypassed.

After updating, restart Eagle-Lab, close the old embedded workspace, reload the portal, reconnect, and sign in to PVE again. This does not implement automatic root login: enter the displayed PVE credentials and choose the Linux PAM realm for root. Proxied management scripts use `no-store` so fixes are not held in a stale browser asset cache.

For an offline node, read the diagnostic in its details or in **Manage servers**:

- **HTTP 401/403; sign-in required** means the node is reachable and is shown **Up**. Anonymous version probes normally do not have a login ticket.
- **TLS certificate validation failed** means the saved certificate policy rejected the node's certificate, including a self-signed chain, expired certificate, or hostname mismatch. Configure the node's certificate trust option to match your lab, or install a trusted certificate/CA.
- **Connection refused / no network route / timed out** means the LXC could not reach the saved IP on HTTPS port 8006. Check the saved IP, LXC bridge/VLAN/routing, and PVE/container firewall rules.

To separate connectivity from certificate validation, run from the Eagle-Lab LXC, replacing `192.168.1.10` with the enrolled PVE IP:

```sh
curl -k -sS --connect-timeout 5 --max-time 8 -o /dev/null -w 'HTTP %{http_code}\n' https://192.168.1.10:8006/api2/json/version
```

HTTP 200, 401, or 403 proves an HTTPS response was received. A timeout/refusal indicates a network or service problem. Repeat without `-k` to test certificate trust. `-k` is for this diagnostic only; it does not change portal settings.

Official references: [Proxmox administration guide](https://pve.proxmox.com/pve-docs/pve-admin-guide.html), [serial terminals](https://pve.proxmox.com/wiki/Serial_Terminal), [VM displays and VNC clipboard](https://pve.proxmox.com/pve-docs/chapter-qm.html#qm_display), [PVE API proxy](https://pve.proxmox.com/pve-docs/pveproxy.8.html).

## Configuration

Environment variables are read at startup. `start.sh` loads `.env` automatically. When running Node directly, use `node --env-file-if-exists=.env server.mjs` to load it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listening address. Use `127.0.0.1` for host-only access. |
| `PORT` | `3000` | Portal port. |
| `DATA_DIR` | `./data` beside the source | SQLite database and encryption key. |
| `PROXY_PORT_START` | `8100` | First per-node listener port. |
| `PROXY_PORT_END` | `8199` | Last per-node listener port. |
| `STATUS_INTERVAL_MS` | `5000` | Probe cadence; minimum 2000 ms. |
| `STATUS_TIMEOUT_MS` | `5000` | End-to-end probe deadline, including TCP/TLS setup; 500–60000 ms. |
| `TLS_CERT` / `TLS_KEY` | unset | PEM certificate and key. Both are required for HTTPS. |
| `SETUP_TOKEN` | unset | Allows remote first-time setup when the supplied token matches. |
| `AUTO_SETUP` | unset; `1` in start.sh | Generates a persistent first-run remote token if no admin or explicit token exists. |
| `PUBLIC_URL` | inferred from request | Browser-accessible full portal origin displayed by `/eagleide/`. HTTP(S), no credentials/query/path. |

Initial setup is restricted to requests from loopback unless `SETUP_TOKEN` is configured. This avoids an unconfigured portal being claimed by another LAN visitor. For a remote host, set a long random token in its environment, open the portal, click instructor sign in, and supply the token along with your chosen credentials. Remove the token from the environment after setup. A configured administrator prevents setup from running again.

Admin sessions and student unlocks expire after eight hours. Admin sessions end on process restart. Student grants are signed with the persistent data key and remain valid until expiry or a server edit. If an admin forgets their password, stop the portal, back up its data, and use a local SQLite administrator tool to delete only the `admin_user` and `admin_hash` rows in `settings`; restart and repeat trusted first-time setup. Keep all other rows and the encryption key.

## Docker

The included Docker image uses Node 24 and runs as the unprivileged `node` user. Docker Compose publishes the portal port and the full proxy range and keeps data in a named volume.

```powershell
$env:SETUP_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Keep the generated token available for the first-time setup form.
docker compose up -d --build
```

In a Linux shell:

```sh
export SETUP_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
docker compose up -d --build
```

Docker’s NAT means an apparently local browser request may not arrive from the container’s loopback interface, so use the token setup flow. Compose requires `SETUP_TOKEN` to be set each time it parses its configuration, including after setup; it is ignored by the app once an admin exists. Use your normal environment/secret management for ongoing deployment.

For Docker HTTPS, mount your certificate directory read-only and add `TLS_CERT`/`TLS_KEY` pointing to the mounted PEM paths. Keep the portal and proxy ports mapped one-to-one; all use the same protocol. For boot persistence on a Linux VM/LXC, Docker Compose’s restart policy starts the portal with Docker. Ensure Docker itself is configured to start at boot.

## Backups and boundaries

Stop the application before copying the entire data directory (or named volume). Keep **`lab.sqlite` and `secret.key` together**, plus any WAL files if present. The database contains encrypted PVE passwords; the key decrypts them. Restrict host filesystem access and protect backups. Losing the key means re-entering the PVE passwords. Never commit this directory to source control.

The student PIN protects access **through this portal**. It does not restrict direct access to PVE or the attached LAN. Use distinct PVE passwords per server if students should not log directly into each other’s hosts. The portal does not perform network isolation or manage PVE accounts. This matches a trusted, local classroom environment; do not expose it to the Internet.

## Verification

```sh
node --test tests/*.test.mjs
```

The suite checks scrypt hashing, authenticated credential encryption, grant tampering/expiry/revision checks, private-address validation, admin authorization, mutation origins, PIN gating, credential/notes privacy, issue status, task edits, restart persistence, live Up/Down transitions, cookie isolation, iframe headers, and bidirectional binary WebSocket forwarding. The integration test starts a temporary synthetic PVE HTTPS service on local port 8006 and needs an available private LAN interface and that port free. It never connects to a real PVE host or uses real credentials.

Browser QA covers the local responsive portal. A real PVE server and its credentials were not supplied during implementation, so authentic PVE login, graphical VM clipboard integration, and student-to-host firewall reachability remain deployment checks.

GitHub Actions runs the startup script and the integration suite in clean Ubuntu 22.04 and 24.04 containers. This exercises native Linux dependency installation and execution; an actual school's PVE/LXC network and browser trust remain site-specific checks. The bundled datacenter background is served locally; see [image attribution](ASSETS.md).

For manual browser QA, `node tests/ui-fixture.mjs` starts a disposable portal at port 3300, a synthetic PVE HTTPS service at port 8006, and a restricted EagleIDE gateway contract fixture at port 3400. All records and test-only credentials are isolated under ignored `test-results/ui`. The fixture's nested-console button tests an RFB greeting over the real WebSocket path; it does not create or access an actual VM. Stop it before running integration tests because both use a local test listener on port 8006.
