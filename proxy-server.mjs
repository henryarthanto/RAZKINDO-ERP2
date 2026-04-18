// =====================================================================
// SINGLE-PORT REVERSE PROXY for Cloudflare Tunnel
//
// Cloudflare Tunnel only proxies one port per hostname. This proxy
// allows both Next.js (HTTP) and event-queue (WebSocket /socket.io)
// to share a single port, making Cloudflare Tunnel work seamlessly.
//
// Routing:
//   /socket.io/*  → event-queue (port 3004)  [WebSocket + polling]
//   everything    → Next.js      (port 3001)  [all other HTTP]
//
// Usage:
//   node proxy-server.mjs
//   (called from docker-entrypoint.sh)
// =====================================================================

import http from 'http';
import net from 'net';

const NEXTJS_HOST = '127.0.0.1';
const NEXTJS_PORT = parseInt(process.env.PROXY_NEXT_PORT || '3001', 10);
const EQ_HOST = '127.0.0.1';
const EQ_PORT = parseInt(process.env.PROXY_EQ_PORT || '3004', 10);
const LISTEN_PORT = parseInt(process.env.PORT || '3000', 10);
const LISTEN_HOST = process.env.HOSTNAME || '0.0.0.0';

/** Check if a request should go to the event-queue (socket.io) */
function isSocketIORequest(url) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  return pathname === '/socket.io' || pathname.startsWith('/socket.io/');
}

// =====================================================================
// HTTP Proxy
// =====================================================================

function proxyHTTP(clientReq, clientRes, targetHost, targetPort) {
  const req = http.request({
    hostname: targetHost,
    port: targetPort,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
  }, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  req.on('error', (err) => {
    console.error(`[Proxy] Error proxying to ${targetHost}:${targetPort}:`, err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    clientRes.end('Bad Gateway');
  });

  clientReq.pipe(req);
}

// =====================================================================
// WebSocket Proxy
// =====================================================================

function proxyWebSocket(clientReq, clientSocket, clientHead, targetHost, targetPort) {
  const targetSocket = net.connect(targetPort, targetHost, () => {
    // Build the HTTP upgrade request to send to the target
    const headers = [];
    for (const [key, value] of Object.entries(clientReq.headers)) {
      if (key === 'host') continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.push(`${key}: ${v}`);
      } else {
        headers.push(`${key}: ${value}`);
      }
    }

    const upgradeRequest = [
      `${clientReq.method} ${clientReq.url} HTTP/${clientReq.httpVersion}`,
      `Host: ${targetHost}:${targetPort}`,
      ...headers,
      '',
      '',
    ].join('\r\n');

    // Send any data from the client's WebSocket handshake
    if (clientHead && clientHead.length > 0) {
      targetSocket.write(clientHead);
    }
    targetSocket.write(upgradeRequest);

    // Bidirectional pipe
    targetSocket.pipe(clientSocket);
    clientSocket.pipe(targetSocket);
  });

  targetSocket.on('error', (err) => {
    console.error(`[Proxy] WebSocket error to ${targetHost}:${targetPort}:`, err.message);
    clientSocket.destroy();
  });

  clientSocket.on('error', () => {
    targetSocket.destroy();
  });
}

// =====================================================================
// Create Server
// =====================================================================

const server = http.createServer((clientReq, clientRes) => {
  const isWS = isSocketIORequest(clientReq.url);
  const targetHost = isWS ? EQ_HOST : NEXTJS_HOST;
  const targetPort = isWS ? EQ_PORT : NEXTJS_PORT;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Proxy] ${clientReq.method} ${clientReq.url} -> ${targetHost}:${targetPort}`);
  }

  proxyHTTP(clientReq, clientRes, targetHost, targetPort);
});

// Handle WebSocket upgrade requests
server.on('upgrade', (clientReq, clientSocket, clientHead) => {
  const isWS = isSocketIORequest(clientReq.url);

  if (isWS) {
    proxyWebSocket(clientReq, clientSocket, clientHead, EQ_HOST, EQ_PORT);
  } else {
    console.warn(`[Proxy] WebSocket upgrade rejected for: ${clientReq.url}`);
    clientSocket.write('HTTP/1.1 426 Upgrade Required\r\n\r\n');
    clientSocket.destroy();
  }
});

server.on('error', (err) => {
  console.error('[Proxy] Server error:', err.message);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[Proxy] Single-port reverse proxy listening on ${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`[Proxy] Next.js backend:      http://${NEXTJS_HOST}:${NEXTJS_PORT}`);
  console.log(`[Proxy] Event Queue backend:  http://${EQ_HOST}:${EQ_PORT}`);
  console.log(`[Proxy] WebSocket routing:    /socket.io/* -> Event Queue`);
  console.log(`[Proxy] All other requests:   /* -> Next.js`);
});
