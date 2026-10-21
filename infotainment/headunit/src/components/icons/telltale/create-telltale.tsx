import React, { useId } from "react";
import { cn } from "@/lib/utils";

export interface TelltaleProps extends React.SVGProps<SVGSVGElement> {
    /** Width and height in px (number) or any CSS length. Defaults to 24, like lucide. */
    size?: number | string;
    /** Accessible name. Without it (or an aria-label) the icon is hidden from screen readers. */
    title?: string;
}

export type TelltaleIcon = React.FC<TelltaleProps>;

/**
 * Strokes inside a glyph. The root svg fills with currentColor, so anything drawn with this
 * group (or with plain filled shapes) follows the text colour - `className="text-blue-600"`.
 */
export const Line = (props: React.SVGProps<SVGGElement>) => (
    <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
    />
);

const toKebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * Builds a single-colour dashboard telltale on a 24x24 grid.
 *
 * `glyph` is the visible shape. `knockout` is cut out of it (drawn through a mask), which is how
 * symbols like "!" inside a filled triangle stay transparent instead of needing a second colour.
 */
export function createTelltale(
    name: string,
    glyph: React.ReactNode,
    knockout?: React.ReactNode
): TelltaleIcon {
    const Icon = ({ size = 24, title, className, children, ...props }: TelltaleProps) => {
        // Name prefix: even if two React roots hand out the same id, the masks behind it match.
        const maskId = `telltale-${name}${useId()}`;
        const labelled = Boolean(title || props["aria-label"] || props["aria-labelledby"]);

        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="currentColor"
                role={labelled ? "img" : undefined}
                aria-hidden={labelled ? undefined : true}
                className={cn("telltale", `telltale-${toKebab(name)}`, className)}
                {...props}
            >
                {title && <title>{title}</title>}
                {knockout ? (
                    <>
                        <mask
                            id={maskId}
                            maskUnits="userSpaceOnUse"
                            x="0"
                            y="0"
                            width="24"
                            height="24"
                        >
                            <rect width="24" height="24" fill="white" />
                            <g color="black" fill="black">
                                {knockout}
                            </g>
                        </mask>
                        <g mask={`url(#${maskId})`}>{glyph}</g>
                    </>
                ) : (
                    glyph
                )}
                {children}
            </svg>
        );
    };
    Icon.displayName = name;
    return Icon;
}
