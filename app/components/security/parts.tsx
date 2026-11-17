// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { ReactNode } from "react";
import { ApiError } from "~/services/api";

/** One subject of the sign-in and security page: its name, a line about it, and its controls. */
export function Section({
	title,
	about,
	children,
}: {
	title: string;
	about: string;
	children: ReactNode;
}) {
	return (
		<section className="rounded-xl border border-kumo-line bg-kumo-base p-5">
			<h2 className="text-base font-semibold text-kumo-default">{title}</h2>
			<p className="text-sm text-kumo-subtle mt-1">{about}</p>
			<div className="mt-4 space-y-3">{children}</div>
		</section>
	);
}

export function Problem({ text }: { text: string | null }) {
	if (text === null) return null;
	return (
		<p role="alert" className="text-sm text-kumo-danger">
			{text}
		</p>
	);
}

/** What the Worker said went wrong, or the app's own words when it said nothing. */
export function message(error: unknown, fallback: string): string {
	return error instanceof ApiError && error.message ? error.message : fallback;
}
