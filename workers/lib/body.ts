// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Reading a request's body with a limit. A route that takes a bounded body reads it here, so
 * a body over the limit is refused without being read to its end.
 */

/** The body as text, or `null` when it is longer than `max` bytes. Never reads past the limit. */
export async function bodyWithin(request: Request, max: number): Promise<string | null> {
	if (Number(request.headers.get("content-length") ?? 0) > max) return null;
	if (request.body === null) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}
