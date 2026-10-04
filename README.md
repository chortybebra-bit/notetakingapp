# Folio

Anonymous, end-to-end encrypted shared notes. Pages, subpages, slash commands, task lists, and live cursors, with no accounts.

Built on the open-source editing stack used by Notion-style apps such as [AFFiNE](https://github.com/toeverything/AFFiNE): [Tiptap](https://github.com/ueberdosis/tiptap) for the editor and [Yjs](https://github.com/yjs/yjs) for conflict-free syncing.

## How privacy works

- **Encryption.** Each space has a random 256-bit key. Every edit is encrypted in the browser (AES-256-GCM) before it is sent. The key sits after the `#` in the invite link, and browsers never send that part to a server.
- **Blind relay.** Browsers talk only to the Folio server, never to each other. The server stores and forwards ciphertext. It never sees page titles, text, aliases, or the key, and it keeps no request or IP logs.
- **Opaque storage.** Room names on the server are HMAC-SHA256(key, label), so they look random. Without the key, nobody can tell which rooms belong to the same space or how many pages a space has, or find a space's rooms at all. Every message is padded to a size bucket (512 bytes, 1 KB, 2 KB, and so on), so a keystroke and a short paragraph look the same.
- **No identity.** There are no accounts, emails, or phone numbers. You get a random alias such as "Amber Moth" in every space. Aliases are separate per space, so two spaces cannot be linked by name.
- **No third parties.** The page loads nothing from other sites. Its security policy only allows connections to its own server.
- **Clean devices.** After you open an invite, the key is removed from the address bar and browser history. "Wipe this device" on the home screen deletes every key and cached note.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Put it on a VPS

A VPS is the right choice. It is always on, and neither of you has to expose your home connection.

### Option 1: onion service (most anonymous)

Nobody, including you, learns the other person's IP address. You don't need a domain, a TLS certificate, or an open port.

```bash
# on the VPS, with Docker installed
git clone <this repo> folio && cd folio/deploy
docker compose --profile onion up -d --build
docker compose exec tor cat /var/lib/tor/folio/hostname
```

That prints an address like `abcd…xyz.onion`. You and your teammate both open it in [Tor Browser](https://www.torproject.org/download/), create or join a space, and share the invite link.

### Option 2: HTTPS (most convenient, works where Tor is blocked)

This works in any browser and can be installed as an app. The server can see visitors' IP addresses, so use a VPN if that matters.

You don't need to buy a domain. [sslip.io](https://sslip.io) names resolve to the IP written inside them, so a VPS at `203.0.113.7` is reachable as `203-0-113-7.sslip.io` with no registration:

```bash
cd folio/deploy
DOMAIN=203-0-113-7.sslip.io docker compose --profile https up -d --build
```

Open `https://203-0-113-7.sslip.io`. Ports 80 and 443 must be open on the VPS firewall. Caddy obtains a Let's Encrypt certificate automatically. With your own domain, point its DNS A record at the VPS and use `DOMAIN=notes.example.com` instead.

Certificates are published in public Certificate Transparency logs, so the hostname (and with sslip.io, the IP) becomes publicly listed as hosting a website. It says nothing about who uses it.

### On a server that already runs nginx

If ports 80 and 443 are taken, skip Caddy. Run only Folio, which listens on `127.0.0.1:8080`, and proxy to it:

```bash
cd folio/deploy
docker compose up -d --build
```

Then follow the three steps at the top of [`deploy/nginx.conf`](deploy/nginx.conf). Certbot adds the certificate.

### Without Docker

Requires Node 22.13 or newer.

```bash
npm ci && npm run build
STATIC_DIR=dist HOST=0.0.0.0 PORT=8080 npm start
```

Open `http://<server-ip>:8080`. `npm run dev` also works and serves on port 5173.

### Plain http

Folio works over plain `http://`. Browsers hide their built-in crypto there, so Folio switches to the audited pure-JavaScript [@noble](https://github.com/paulmillr/noble-ciphers) implementations of the same algorithms. The data is identical, so http and https clients can share a space.

The server still only stores ciphertext. What http loses is protection in transit: anyone on the network path (Wi-Fi, ISP, the hosting provider) can read or modify the app code as it loads, and modified code could steal keys. Use HTTPS or the onion service when that matters.

## Storage

The server keeps one SQLite database, `folio.db`, in its data directory (`server/data` locally, the `folio-data` Docker volume on a VPS). Each row is one encrypted update stored under an opaque room ID; there are no names, titles, IPs, or timestamps. Appending an edit writes one row, and compaction replaces a room's rows in a single transaction, so storage cost does not grow with the total amount of data. The files are readable only by the server's user. Restarting the server loses nothing. A `rooms.json` from older versions is imported on first start and then deleted.

## Browser or app?

Folio runs in the browser, and the browser can install it as an app. On the HTTPS version, choose **Install as app** in the sidebar or on the home screen. It then opens in its own window with an icon, and the app shell works offline.

For maximum anonymity, use Tor Browser with the onion address. Tor Browser cannot install apps, but it hides your IP address, which matters more.

## What can still identify you

- **The invite link.** Anyone who has it can read and edit. Send it over an end-to-end encrypted chat with disappearing messages, then delete it.
- **Your devices.** Each browser stores the keys of saved spaces. Malware or someone with access to an unlocked device can read the notes.
- **Who pays for the VPS.** The hosting account and payment can be traced to a person. Pay anonymously if that matters, and don't use a domain registered in your name.
- **The server operator.** Whoever runs the VPS cannot read notes, but could change the app code it serves. Only use a server that someone on the team controls.
- **Writing style and timing.** Encryption doesn't hide how you write or when you are online.
- **Connection patterns.** The server can see that some number of anonymous connections use the same room, and when each one sends a message. Over Tor, those connections carry no IP address or account, so it learns "two unknown parties", not who they are.

## Checks

```bash
npm run check:relay   # server stores only ciphertext; wrong key is rejected
npm run check:ui      # two separate browsers co-edit; no WebRTC, no third-party requests,
                      # no key in the address bar, no plaintext on the server
```

Both expect `npm run dev` to be running. To test a production server, pass its address: `node scripts/ui-check.mjs http://127.0.0.1:8080/ <data-dir>`.
