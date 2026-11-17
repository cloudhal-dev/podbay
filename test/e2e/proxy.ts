// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The only way out of the test browser. Chrome is told to use this as its proxy, so every
 * connection it tries to make to anything but the app on localhost arrives here, whichever
 * process of the browser made it. Each attempt is written down and refused: nothing leaves the
 * machine, and a test can ask exactly which hosts a message made the browser contact.
 *
 * This is what "no request left" rests on. The browser's own request events are not enough:
 * the mail frame is sandboxed, Chrome runs it in a process of its own, and requests from there
 * can start before a debugger sees them.
 *
 *   GET  /__contacts   the hosts contacted since the last reset
 *   POST /__reset      forget them
 */
import { createServer } from "node:http";
import { PROXY_PORT } from "./proxy-address.ts";

const contacts: string[] = [];

const server = createServer((request, response) => {
	const url = request.url ?? "";
	// A request for a path is the test talking to this server; one for a full URL is the browser
	// asking to be proxied to a plain-http site.
	if (url === "/__contacts") {
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(contacts));
		return;
	}
	if (url === "/__reset") {
		contacts.length = 0;
		response.writeHead(204);
		response.end();
		return;
	}
	if (/^https?:\/\//i.test(url)) contacts.push(new URL(url).hostname);
	response.writeHead(502);
	response.end();
});

// `CONNECT host:443` is how a browser asks a proxy for a tunnel to an https site.
server.on("connect", (request, socket) => {
	// The browser may drop the connection while it is being refused. That is its business: an
	// error on one socket must not take the proxy, and with it every later test, down.
	socket.on("error", () => {});
	contacts.push((request.url ?? "").replace(/:\d+$/, ""));
	socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
});

// The same for a request that is cut off or malformed before it is one.
server.on("clientError", (_error, socket) => socket.destroy());

server.listen(PROXY_PORT, "127.0.0.1");
process.on("SIGTERM", () => server.close());
