/**
 * Test doubles for the two things a person holds: a passkey and an authenticator app.
 *
 * `createPasskey` is a software WebAuthn authenticator. It makes a real P-256 key, a real
 * attestation ("none") and real signed assertions, so the server's own verification runs in
 * full; nothing is mocked on the server side. `totpCode` computes the code an authenticator app
 * would show (RFC 6238, SHA-1, 6 digits, 30 seconds).
 */

type Bytes = Uint8Array<ArrayBuffer>;

const utf8 = new TextEncoder();

function concat(...parts: (Bytes | number[])[]): Bytes {
	const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
	const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
	let at = 0;
	for (const a of arrays) {
		out.set(a, at);
		at += a.length;
	}
	return out;
}

export function base64url(bytes: Bytes): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Bytes {
	const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function sha256(data: Bytes): Promise<Bytes> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

// ── a minimal CBOR encoder: only what an attestation object needs ──

function head(major: number, n: number): Bytes {
	if (n < 24) return Uint8Array.from([(major << 5) | n]);
	if (n < 256) return Uint8Array.from([(major << 5) | 24, n]);
	return Uint8Array.from([(major << 5) | 25, n >> 8, n & 0xff]);
}
const cborInt = (n: number) => (n >= 0 ? head(0, n) : head(1, -1 - n));
const cborBytes = (b: Bytes) => concat(head(2, b.length), b);
const text = (s: string): Bytes => Uint8Array.from(utf8.encode(s));
const cborText = (s: string) => concat(head(3, text(s).length), text(s));
const cborMap = (entries: [Bytes, Bytes][]) => concat(head(5, entries.length), ...entries.flat());

/** An ECDSA signature as WebCrypto gives it (r || s) in the DER form WebAuthn uses. */
function derSignature(raw: Bytes): Bytes {
	const integer = (bytes: Bytes) => {
		let start = 0;
		while (start < bytes.length - 1 && bytes[start] === 0) start++;
		const trimmed = bytes.slice(start);
		const value = (trimmed[0] ?? 0) & 0x80 ? concat([0], trimmed) : trimmed;
		return concat([0x02, value.length], value);
	};
	const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
	return concat([0x30, body.length], body);
}

const u32 = (n: number) =>
	Uint8Array.from([n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);

export interface RegistrationOptions {
	challenge: string;
	rp: { id: string };
	user: { id: string };
}
export interface AssertionOptions {
	challenge: string;
	rpId?: string;
}

export interface SoftwarePasskey {
	readonly id: string;
	/** The answer to `navigator.credentials.create`. */
	register(options: RegistrationOptions, origin: string): Promise<Record<string, unknown>>;
	/** The answer to `navigator.credentials.get`. `verified: false` is a touch without PIN or biometrics. */
	assert(
		options: AssertionOptions,
		origin: string,
		how?: { verified?: boolean; rpId?: string },
	): Promise<Record<string, unknown>>;
}

export async function createPasskey(): Promise<SoftwarePasskey> {
	const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
	const credentialId = crypto.getRandomValues(new Uint8Array(16));
	const id = base64url(credentialId);
	let rpId = "";
	let userHandle = "";
	let signCount = 0;

	const clientData = (type: string, challenge: string, origin: string) =>
		text(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

	return {
		id,
		async register(options, origin) {
			rpId = options.rp.id;
			userHandle = options.user.id;
			const publicKey = cborMap([
				[cborInt(1), cborInt(2)], // kty: EC2
				[cborInt(3), cborInt(-7)], // alg: ES256
				[cborInt(-1), cborInt(1)], // crv: P-256
				[cborInt(-2), cborBytes(fromBase64url(jwk.x ?? ""))],
				[cborInt(-3), cborBytes(fromBase64url(jwk.y ?? ""))],
			]);
			const authData = concat(
				await sha256(text(rpId)),
				[0x45], // user present, user verified, attested credential data
				u32(0),
				new Uint8Array(16), // aaguid
				[credentialId.length >> 8, credentialId.length & 0xff],
				credentialId,
				publicKey,
			);
			const attestation = cborMap([
				[cborText("fmt"), cborText("none")],
				[cborText("attStmt"), cborMap([])],
				[cborText("authData"), cborBytes(authData)],
			]);
			return {
				id,
				rawId: id,
				type: "public-key",
				authenticatorAttachment: "platform",
				clientExtensionResults: {},
				response: {
					clientDataJSON: base64url(clientData("webauthn.create", options.challenge, origin)),
					attestationObject: base64url(attestation),
					transports: ["internal"],
				},
			};
		},
		async assert(options, origin, how = {}) {
			signCount += 1;
			const authData = concat(
				await sha256(text(how.rpId ?? rpId)),
				[how.verified === false ? 0x01 : 0x05],
				u32(signCount),
			);
			const client = clientData("webauthn.get", options.challenge, origin);
			const signature = new Uint8Array(
				await crypto.subtle.sign(
					{ name: "ECDSA", hash: "SHA-256" },
					pair.privateKey,
					concat(authData, await sha256(client)),
				),
			);
			return {
				id,
				rawId: id,
				type: "public-key",
				authenticatorAttachment: "platform",
				clientExtensionResults: {},
				response: {
					clientDataJSON: base64url(client),
					authenticatorData: base64url(authData),
					signature: base64url(derSignature(signature)),
					userHandle,
				},
			};
		},
	};
}

// ── the authenticator app ──

function base32Decode(text: string): Bytes {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const char of text.replace(/=+$/, "").toUpperCase()) {
		bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
	}
	const bytes = bits.match(/.{8}/g) ?? [];
	return Uint8Array.from(bytes, (b) => Number.parseInt(b, 2));
}

/** The six-digit code for the secret in an `otpauth://` link, at `at` (now by default). */
export async function totpCode(otpauthUri: string, at: number = Date.now()): Promise<string> {
	const secret = new URL(otpauthUri).searchParams.get("secret") ?? "";
	const key = await crypto.subtle.importKey(
		"raw",
		base32Decode(secret),
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	const counter = new Uint8Array(8);
	new DataView(counter.buffer).setUint32(4, Math.floor(at / 30_000));
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
	const offset = (mac[19] ?? 0) & 0x0f;
	const value = new DataView(mac.buffer).getUint32(offset) & 0x7fffffff;
	return (value % 1_000_000).toString().padStart(6, "0");
}
