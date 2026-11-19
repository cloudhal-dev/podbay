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
 *   POST /__reset      forget them, and every answer
 *   POST /__answer     answer one host: `{ host, delayMs, contentType, body }` (body in base64)
 *
 * By default nothing is answered. A test that needs a picture to arrive late names its host,
 * which must end in `.test` (a name that is never on the internet), and only that host's tunnels
 * are opened and answered here, with the test's own bytes after the test's own delay. They are
 * written down like every other contact, so "which hosts were contacted" stays true. The tunnel
 * is TLS with a certificate made by `openssl` when this server starts (the browser tests need it
 * on the machine), kept in `.e2e/` (ignored by git, never uploaded) and nowhere else; only a
 * test that asks for it (`ignoreHTTPSErrors`) accepts it.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROXY_CERT, PROXY_KEY, PROXY_PORT } from "./proxy-address.ts";

const contacts: string[] = [];

interface Answer {
	delayMs: number;
	contentType: string;
	body: Buffer;
}

/** The hosts a test asked to be answered, forgotten at every reset. */
const answers = new Map<string, Answer>();

/** A name that can never be on the internet: one or more labels, ending in `.test`. */
const TEST_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+test$/;

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const keyPath = root(PROXY_KEY);
const certPath = root(PROXY_CERT);
mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
// A certificate for this run only, signed by itself; nothing trusts it but a test that says so.
// The files exist, readable by this user alone, before a byte of the key is written.
for (const path of [keyPath, certPath]) writeFileSync(path, "", { mode: 0o600 });
try {
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"ec",
			"-pkeyopt",
			"ec_paramgen_curve:prime256v1",
			"-noenc",
			"-days",
			"1",
			"-subj",
			"/CN=podbay-e2e-proxy",
			"-keyout",
			keyPath,
			"-out",
			certPath,
		],
		{ stdio: "ignore" },
	);
} catch {
	throw new Error(
		"e2e proxy: openssl (3.0 or newer) is needed to make the run's certificate and did not run; install it and run again.",
	);
}
for (const path of [keyPath, certPath]) chmodSync(path, 0o600);

const answering = createTlsServer(
	{ key: readFileSync(keyPath), cert: readFileSync(certPath) },
	(request, response) => {
		const host = (request.headers.host ?? "").replace(/:\d+$/, "");
		const answer = answers.get(host);
		if (!answer) {
			response.writeHead(502);
			response.end();
			return;
		}
		setTimeout(() => {
			response.writeHead(200, { "content-type": answer.contentType, "cache-control": "no-store" });
			response.end(answer.body);
		}, answer.delayMs);
	},
);
answering.on("tlsClientError", () => {});

async function readBody(request: import("node:http").IncomingMessage): Promise<string> {
	const parts: Buffer[] = [];
	for await (const part of request) parts.push(part as Buffer);
	return Buffer.concat(parts).toString("utf8");
}

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
		answers.clear();
		response.writeHead(204);
		response.end();
		return;
	}
	if (url === "/__answer" && request.method === "POST") {
		void readBody(request).then((text) => {
			let asked: { host?: unknown; delayMs?: unknown; contentType?: unknown; body?: unknown };
			try {
				asked = JSON.parse(text);
			} catch {
				asked = {};
			}
			if (
				typeof asked.host !== "string" ||
				!TEST_HOST.test(asked.host) ||
				typeof asked.delayMs !== "number" ||
				typeof asked.contentType !== "string" ||
				typeof asked.body !== "string"
			) {
				response.writeHead(400);
				response.end();
				return;
			}
			answers.set(asked.host, {
				delayMs: asked.delayMs,
				contentType: asked.contentType,
				body: Buffer.from(asked.body, "base64"),
			});
			response.writeHead(204);
			response.end();
		});
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
	const host = (request.url ?? "").replace(/:\d+$/, "");
	contacts.push(host);
	if (!answers.has(host)) {
		socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
		return;
	}
	// A host the test named: the tunnel is opened, and this server is at its other end.
	socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
	answering.emit("connection", socket);
});

// The same for a request that is cut off or malformed before it is one.
server.on("clientError", (_error, socket) => socket.destroy());

server.listen(PROXY_PORT, "127.0.0.1");
process.on("SIGTERM", () => {
	server.close();
	answering.close();
});
