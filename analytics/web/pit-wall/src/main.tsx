import "./index.css";
import "./views/theme"; // applies the stored theme before the first render

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadConfig } from "./live/config";
import { live } from "./live/connection";
import { routeTree } from "./routeTree.gen";

const config = await loadConfig();
live.connect(config);

const queryClient = new QueryClient();
const router = createRouter({
    routeTree,
    context: { queryClient, config },
    defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    </StrictMode>
);
