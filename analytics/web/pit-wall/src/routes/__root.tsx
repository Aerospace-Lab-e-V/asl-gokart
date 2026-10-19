import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { ThemeToggle } from "../components/ThemeToggle";
import type { PitWallConfig } from "../live/config";

export interface RouterContext {
    queryClient: QueryClient;
    config: PitWallConfig;
}

export const Route = createRootRouteWithContext<RouterContext>()({
    component: RootLayout,
});

function RootLayout() {
    return (
        <div className="flex min-h-dvh flex-col">
            <header className="navbar bg-base-200 min-h-12 px-3 sm:px-4">
                <div className="navbar-start">
                    <Link to="/" className="text-lg font-semibold">
                        Pit wall
                    </Link>
                </div>
                <div className="navbar-end">
                    <ThemeToggle />
                </div>
            </header>
            <main className="flex-1 px-3 pt-3 pb-20 sm:px-4 sm:pt-4 md:pb-4">
                <Outlet />
            </main>
        </div>
    );
}
