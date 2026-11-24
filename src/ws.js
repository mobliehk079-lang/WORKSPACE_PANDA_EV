// Minimal WebSocket server (RFC 6455) with no dependencies — text frames, ping/pong, close.
// Enough for small JSON game messages (Panda Jump). Messages over 64 KB close the connection.
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX = 64 * 1024;

/** Completes the upgrade handshake. Returns a socket wrapper, or null when the request is not a WebSocket upgrade. */
export function acceptWebSocket(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const ws = new WebSocketConn(socket);
  if (head?.length) ws.onData(head);
  return ws;
}

export function rejectUpgrade(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

class WebSocketConn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
    this.seen = Date.now();
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
    // Keep proxies from dropping an idle connection; give up on a peer that stopped answering
    this.pinger = setInterval(() => {
      if (Date.now() - this.seen > 60_000) return this.close(1001);
      this.frame(0x9, Buffer.alloc(0));
    }, 20_000);
  }

  onData(d) {
    this.seen = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX)) return this.close(1009);
        len = Number(big); off = 10;
      }
      if (len > MAX) return this.close(1009);
      if (!masked) return this.close(1002); // clients must mask
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);

      if (op === 0x8) return this.close();
      if (op === 0x9) { this.frame(0xa, payload); continue; }
      if (op === 0xa) continue;
      if (op === 0x0 || op === 0x1 || op === 0x2) {
        this.frags.push(payload);
        if (this.frags.reduce((n, f) => n + f.length, 0) > MAX) return this.close(1009);
        if (!fin) continue;
        const msg = Buffer.concat(this.frags).toString('utf8');
        this.frags = [];
        try { this.onmessage?.(msg); } catch (e) { console.error('ws message handler failed:', e); }
        if (!this.open) return;
      } else return this.close(1002);
    }
  }

  frame(op, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
    this.socket.write(Buffer.concat([h, payload]));
  }

  /** volatile: skip the message when the peer is slow (position updates — a newer one follows soon) */
  send(obj, volatile = false) {
    if (volatile && this.socket.writableLength > 256 * 1024) return;
    this.frame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));
  }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    this.frame(0x8, p);
    this.open = false;
    this.socket.end();
    this.closed();
  }

  closed() {
    if (this.done) return;
    this.done = true;
    this.open = false;
    clearInterval(this.pinger);
    if (!this.socket.destroyed) setTimeout(() => this.socket.destroy(), 1000).unref();
    this.onclose?.();
  }
}
