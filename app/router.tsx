// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The route tree. Podbay is a single-page app: the Worker serves the API and static assets, and
 * every screen is routed here in the browser.
 */
import { Button, Empty, LinkProvider, Toasty, TooltipProvider } from "@cloudflare/kumo";
import { WarningIcon } from "@phosphor-icons/react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { forwardRef } from "react";
import EmailListRoute from "~/routes/email-list";
import HomeRoute from "~/routes/home";
import MailboxRoute from "~/routes/mailbox";
import NotFoundRoute from "~/routes/not-found";
import SearchResultsRoute from "~/routes/search-results";
import SettingsRoute from "~/routes/settings";
import { ApiError } from "~/services/api";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			refetchOnWindowFocus: false,
			retry: (failureCount, error) => {
				// A 4xx answer (not found, not allowed) will not change on a retry.
				if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
					return false;
				}
				return failureCount < 2;
			},
		},
	},
	mutationCache: new MutationCache({
		onError: (error) => {
			// Fallback for mutations that do not handle their own errors.
			console.error("Mutation failed:", error);
		},
	}),
});

/** Kumo renders its links through this, so in-app links navigate without a page load. */
const KumoLink = forwardRef<
	HTMLAnchorElement,
	React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }
>(function KumoLink({ href, onClick, ...props }, ref) {
	const router = useRouter();
	const internal = href !== undefined && href.startsWith("/");
	return (
		<a
			href={href}
			ref={ref}
			{...props}
			onClick={(event) => {
				onClick?.(event);
				if (!internal || event.defaultPrevented) return;
				if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
				event.preventDefault();
				void router.navigate({ href });
			}}
		/>
	);
});

function RootLayout() {
	return (
		<QueryClientProvider client={queryClient}>
			<LinkProvider component={KumoLink}>
				<TooltipProvider>
					<Toasty>
						<Outlet />
					</Toasty>
				</TooltipProvider>
			</LinkProvider>
		</QueryClientProvider>
	);
}

function RootError({ error }: { error: unknown }) {
	const description =
		error instanceof Error && import.meta.env.DEV
			? error.message
			: "An unexpected error occurred. Please try again.";
	return (
		<div className="flex items-center justify-center min-h-screen p-8">
			<Empty
				icon={<WarningIcon size={48} className="text-kumo-inactive" />}
				title="Something went wrong"
				description={description}
				contents={
					<Button
						variant="primary"
						onClick={() => {
							window.location.href = "/";
						}}
					>
						Go Home
					</Button>
				}
			/>
		</div>
	);
}

const rootRoute = createRootRoute({
	component: RootLayout,
	errorComponent: RootError,
	notFoundComponent: NotFoundRoute,
});

const homeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: HomeRoute,
});

const mailboxRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mailbox/$mailboxId",
	component: MailboxRoute,
});

const mailboxIndexRoute = createRoute({
	getParentRoute: () => mailboxRoute,
	path: "/",
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/mailbox/$mailboxId/emails/$folder",
			params: { mailboxId: params.mailboxId, folder: "inbox" },
			replace: true,
		});
	},
});

const emailListRoute = createRoute({
	getParentRoute: () => mailboxRoute,
	path: "emails/$folder",
	component: EmailListRoute,
});

const settingsRoute = createRoute({
	getParentRoute: () => mailboxRoute,
	path: "settings",
	component: SettingsRoute,
});

const searchRoute = createRoute({
	getParentRoute: () => mailboxRoute,
	path: "search",
	validateSearch: (search: Record<string, unknown>): { q: string } => ({
		q: typeof search.q === "string" ? search.q : "",
	}),
	component: SearchResultsRoute,
});

const routeTree = rootRoute.addChildren([
	homeRoute,
	mailboxRoute.addChildren([mailboxIndexRoute, emailListRoute, settingsRoute, searchRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
