import React from "react";
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * App-wide toasts: a calm card at the bottom centre of the page content, sized to read at a glance
 * on the 7" cockpit screen.
 *
 * Toasts are unstyled and drawn with the theme tokens, so they follow the `.dark` class like the rest
 * of the app (sonner's own themes would need next-themes, which isn't mounted, and its dark one is plain
 * black). `theme="light"` only keeps sonner's dark-theme overrides from leaking into the unstyled toast.
 */
const Toaster = (props: ToasterProps) => (
    <Sonner
        theme="light"
        position="bottom-center"
        offset={{ bottom: 24 }}
        gap={12}
        // Centre over the page content, not the window: the navbar takes the right w-20 (5rem)
        className="left-[calc(50%-2.5rem)]!"
        style={{ "--width": "min(480px, calc(100vw - 8rem))" } as React.CSSProperties}
        icons={{
            success: <CircleCheck className="h-7 w-7 text-green-600 dark:text-green-500" />,
            error: <CircleAlert className="h-7 w-7 text-red-500" />,
            warning: <TriangleAlert className="h-7 w-7 text-yellow-500" />,
            info: <Info className="text-muted-foreground h-7 w-7" />,
            loading: <LoaderCircle className="text-muted-foreground h-7 w-7 animate-spin" />,
        }}
        toastOptions={{
            unstyled: true,
            classNames: {
                toast: [
                    "flex w-full items-center gap-4 rounded-2xl border px-6 py-4",
                    "border-border bg-background text-foreground shadow-xl shadow-black/10",
                    "dark:bg-secondary dark:border-white/10 dark:shadow-black/50",
                ].join(" "),
                icon: "flex shrink-0 items-center",
                content: "flex min-w-0 flex-col gap-0.5",
                title: "text-lg font-semibold leading-snug",
                description: "text-muted-foreground text-base",
                actionButton: "bg-primary text-primary-foreground ml-auto h-11 shrink-0 rounded-xl px-5 text-base font-semibold",
                cancelButton: "bg-muted text-muted-foreground h-11 shrink-0 rounded-xl px-5 text-base font-semibold",
            },
        }}
        {...props}
    />
);

export { Toaster };
