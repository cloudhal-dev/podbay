// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/** Where the test browser's proxy listens (test/e2e/proxy.ts starts it). */
export const PROXY_PORT = 4175;
export const PROXY = `http://127.0.0.1:${PROXY_PORT}`;

/**
 * The certificate the proxy makes when it starts, for the hosts a test asks it to answer, and its
 * key: in the run's own directory (`.e2e/`, ignored by git and never uploaded), never anywhere else.
 */
export const PROXY_KEY = ".e2e/proxy-key.pem";
export const PROXY_CERT = ".e2e/proxy-cert.pem";
