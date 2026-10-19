import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { HeaderBar } from "@/components/shared/header-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SubpageProps = {
    title: string;
    description?: React.ReactNode;
    /** Where the back button goes; the previous page when left out. */
    backTo?: string;
    /** Keeps the user on the page while something must not be interrupted. */
    backDisabled?: boolean;
    /** Shown at the right of the title row. */
    actions?: React.ReactNode;
    /** Pinned below the scrolling content, for the page's main buttons. */
    footer?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
};

/**
 * A full-screen page that takes the place of a dialog: back button and title on top,
 * scrolling content, optional buttons pinned to the bottom. Sized for the 7" cockpit screen.
 */
export const Subpage = ({ title, description, backTo, backDisabled, actions, footer, className, children }: SubpageProps) => {
    const navigate = useNavigate();

    return (
        <div className="flex h-full w-full flex-col">
            <HeaderBar />

            <div className="flex items-center gap-2 py-2 pr-8 pl-4">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-12 w-12 shrink-0"
                    aria-label="Back"
                    disabled={backDisabled}
                    onClick={() => (backTo ? navigate(backTo) : navigate(-1))}
                >
                    <ChevronLeft className="h-7 w-7" />
                </Button>
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold">{title}</h1>
                    {description && <p className="text-muted-foreground truncate text-base">{description}</p>}
                </div>
                {actions && <div className="ml-auto flex shrink-0 items-center gap-3">{actions}</div>}
            </div>

            <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pb-4", className)}>{children}</div>

            {footer && <div className="flex items-center justify-end gap-3 border-t px-8 py-3">{footer}</div>}
        </div>
    );
};
