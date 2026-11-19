// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: the app's controls are Kumo's (`pnpm static controls`, issue #84). A control written by
 * hand is refused unless it is a listed debt or kept on purpose with its reason, a debt only goes
 * down, and a Kumo control gets no size, height or corner by hand.
 */
import { describe, expect, it } from "vitest";
import {
	controlProblems,
	type OnPurpose,
	type RoleOnPurpose,
	type RoundOnPurpose,
	tagsOf,
} from "../../scripts/checks/controls.ts";

const FILE = "app/components/Thing.tsx";
const problems = (
	text: string,
	options: {
		onPurpose?: OnPurpose[];
		toMove?: Record<string, Record<string, number>>;
		sized?: Record<string, number>;
		roles?: Record<string, number>;
		round?: RoundOnPurpose[];
		rolesKept?: RoleOnPurpose[];
	} = {},
	more: [string, string][] = [],
) =>
	controlProblems(
		new Map([[FILE, text], ...more]),
		options.onPurpose ?? [],
		options.toMove ?? {},
		options.sized ?? {},
		options.roles ?? {},
		options.round ?? [],
		options.rolesKept ?? [],
	);

describe("controls written by hand", () => {
	it.each([
		["a select", '<select aria-label="Size"><option>1</option></select>'],
		["a text area", '<textarea aria-label="Message" />'],
		["an input", '<input type="checkbox" />'],
		["a button", '<button type="button">Go</button>'],
	])("refuses %s in a file with no debt", (_what, text) => {
		expect(problems(text)).toHaveLength(1);
	});

	it("passes Kumo's controls", () => {
		expect(
			problems('<Select aria-label="Size" /><Input label="Name" size="sm" /><Button>Go</Button>'),
		).toEqual([]);
	});

	it("reads a tag whole, across lines and braces, and does not take a longer name for the element", () => {
		expect(
			tagsOf('<input\n  type="text"\n  onChange={(e) => go(e.target.value > 1)}\n/>', ["input"]),
		).toHaveLength(1);
		expect(problems("<inputs /><buttonish />")).toEqual([]);
	});

	it("holds a debt where it is, and refuses one more", () => {
		const toMove = { [FILE]: { button: 1 } };
		expect(problems('<button type="button">One</button>', { toMove })).toEqual([]);
		expect(
			problems('<button type="button">One</button><button type="button">Two</button>', { toMove }),
		).toHaveLength(1);
	});

	it("asks for a debt to be lowered when a control has moved", () => {
		const out = problems("<Button>One</Button>", { toMove: { [FILE]: { button: 1 } } });
		expect(out).toEqual([
			`${FILE}: 0 <button> written by hand, fewer than the 1 listed; lower TO_MOVE in scripts/checks/controls.ts`,
		]);
	});

	it("keeps a native control on purpose only with its reason", () => {
		const kept: OnPurpose = {
			file: FILE,
			element: "button",
			count: 1,
			reason: "The whole line of a message opens it.",
		};
		expect(problems('<button type="button">A line</button>', { onPurpose: [kept] })).toEqual([]);
		expect(
			problems('<button type="button">A line</button>', { onPurpose: [{ ...kept, reason: "" }] }),
		).toHaveLength(1);
	});

	it("refuses a listed file that is gone", () => {
		const out = controlProblems(new Map(), [], { "app/gone.tsx": { input: 1 } }, {}, {}, [], []);
		expect(out).toEqual(["app/gone.tsx: listed in TO_MOVE and gone; remove its line"]);
	});
});

describe("Kumo controls sized by hand", () => {
	it.each([
		["a height", '<Input label="Name" className="h-9" />'],
		["a smallest height", '<Button className="min-h-8">Go</Button>'],
		["a size", '<Button className="size-6">Go</Button>'],
		["a corner", '<Button className="rounded-full">Go</Button>'],
		["a corner by itself", '<Select className="rounded" />'],
		["a type size", '<Input label="Name" className="text-sm" />'],
		["one under a breakpoint", '<Button className="md:h-10">Go</Button>'],
		["one in cn()", '<Button className={cn("w-full", "rounded-lg")}>Go</Button>'],
		["one on its own line", '<Button\n  variant="primary"\n  className="h-12"\n>Go</Button>'],
		["padding", '<Button className="px-6">Go</Button>'],
		["padding on one side", '<Input label="Name" className="pt-1" />'],
		["padding all round", '<Button className="p-0">Go</Button>'],
		["an arbitrary type size", '<Input label="Name" className="text-[13px]" />'],
		["a line height", '<Button className="leading-tight">Go</Button>'],
		["the important mark before", '<Button className="!h-9">Go</Button>'],
		["the important mark after", '<Button className="h-9!">Go</Button>'],
		["a style attribute", '<Input label="Name" style={{ height: 36 }} />'],
		["a dotted part of Kumo's", '<Select.Trigger className="h-9" />'],
		["an input group", '<InputGroup size="lg" className="h-12" />'],
		["a part of an input group", '<InputGroup.Addon align="end" className="pr-1" />'],
	])("refuses %s", (_what, text) => {
		expect(problems(text)).toHaveLength(1);
	});

	it("holds a wrapper of app/components/controls/ as it holds Kumo's", () => {
		const wrapper: [string, string] = [
			"app/components/controls/DateField.tsx",
			"export function DateField() { return null; }",
		];
		expect(problems('<DateField className="h-9" />', {}, [wrapper])).toHaveLength(1);
		expect(problems('<DateField className="w-full" />', {}, [wrapper])).toEqual([]);
	});

	it("leaves width, margins and the screen's layout alone", () => {
		expect(
			problems(
				'<Button className="w-full mt-2 shrink-0">Go</Button><Input label="N" className="max-w-md" />',
			),
		).toEqual([]);
	});

	it("holds a listed debt and asks for it to be lowered", () => {
		expect(
			problems('<Button className="rounded-full">Go</Button>', { sized: { [FILE]: 1 } }),
		).toEqual([]);
		expect(problems("<Button>Go</Button>", { sized: { [FILE]: 1 } })).toHaveLength(1);
	});
});

describe("Kumo controls made round on purpose", () => {
	const listed = (count: number): RoundOnPurpose[] => [
		{ file: FILE, count, reason: "Round as the screen was before Kumo, with its reason here." },
	];
	const pills =
		'<Button className="rounded-full">Reply</Button><Button className="rounded-full" variant="outline">Forward</Button>';

	it("lets a listed file keep exactly the round controls it lists", () => {
		expect(problems(pills, { round: listed(2) })).toEqual([]);
	});

	it("refuses one more, and asks for the list to be lowered when one goes", () => {
		expect(problems(pills, { round: listed(1) })).toHaveLength(2);
		expect(problems(pills, { round: listed(3) })).toEqual([
			`${FILE}: ROUND_ON_PURPOSE lists 3 round Kumo controls, the file has 2`,
		]);
	});

	it.each([
		["padding beside the corner", '<Button className="rounded-full px-5">Go</Button>'],
		["another corner", '<Button className="rounded-lg">Go</Button>'],
		["a corner under a breakpoint", '<Button className="md:rounded-full">Go</Button>'],
		["the important mark", '<Button className="!rounded-full">Go</Button>'],
		["a style attribute", '<Button className="rounded-full" style={{ height: 30 }}>Go</Button>'],
	])("still refuses %s in a listed file", (_what, text) => {
		expect(problems(text, { round: listed(1) })).toHaveLength(2);
	});

	it("needs a reason, and a file that is there", () => {
		expect(
			problems('<Button className="rounded-full">Go</Button>', {
				round: [{ file: FILE, count: 1, reason: "round" }],
			}),
		).toEqual([`${FILE}: a ROUND_ON_PURPOSE line needs its reason`]);
		expect(
			problems("<Button>Go</Button>", {
				round: [{ file: "app/gone.tsx", count: 1, reason: "Round as it was, with its reason." }],
			}),
		).toEqual(["app/gone.tsx: listed in ROUND_ON_PURPOSE and gone; remove its line"]);
	});
});

describe("roles kept on purpose", () => {
	const kept = (
		role: string,
		count: number,
		reason = "The field's own list, with its reason here.",
	): RoleOnPurpose[] => [{ file: FILE, role, count, reason }];
	const list = '<div role="listbox" aria-label="Addresses"><div role="option">a</div></div>';

	it("lets a listed file keep exactly that role, that many times", () => {
		expect(problems(list, { rolesKept: kept("listbox", 1) })).toEqual([]);
	});

	it("refuses one more of the role, and another role", () => {
		expect(problems(list + list, { rolesKept: kept("listbox", 1) })).toHaveLength(1);
		expect(problems('<div role="button">x</div>', { rolesKept: kept("listbox", 1) })).toHaveLength(
			2,
		);
	});

	it("asks for the list to be lowered when one goes, and needs a reason and a file", () => {
		expect(problems("<div />", { rolesKept: kept("listbox", 1) })).toEqual([
			`${FILE}: ROLES_ON_PURPOSE lists 1 with role "listbox", the file has 0`,
		]);
		expect(problems(list, { rolesKept: kept("listbox", 1, "list") })).toEqual([
			`${FILE}: a ROLES_ON_PURPOSE line needs its reason`,
		]);
	});
});

describe("controls made of a role", () => {
	it.each(["button", "checkbox", "radio", "switch", "combobox", "listbox", "textbox", "slider"])(
		"refuses a plain element with the role %s",
		(role) => {
			expect(problems(`<div role="${role}" tabIndex={0}>x</div>`)).toHaveLength(1);
			expect(problems(`<span role={"${role}"}>x</span>`)).toHaveLength(1);
		},
	);

	it("leaves the roles of what is not a control alone", () => {
		expect(problems('<div role="alert">x</div><ul role="list" /><div role="dialog" />')).toEqual(
			[],
		);
	});

	it("holds a listed debt and asks for it to be lowered", () => {
		expect(problems('<div role="listbox">x</div>', { roles: { [FILE]: 1 } })).toEqual([]);
		expect(problems("<div>x</div>", { roles: { [FILE]: 1 } })).toHaveLength(1);
	});
});
