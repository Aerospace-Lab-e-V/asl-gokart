import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronRight, LucideIcon } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { semverCompare } from "@/lib/releases";
import { cn } from "@/lib/utils";

/*
 * Building blocks of the settings pages: full-width rows with large touch targets, so they
 * can be hit on the 7" cockpit screen while wearing gloves. The row list bleeds 16px into the
 * page padding so the pressed highlight and the dividers reach past the text.
 */

const ROW = "flex min-h-18 items-center gap-5 px-4";

type SettingsSectionProps = {
    title: string;
    /** Set when the rows are SettingsRadioRows picking one value. */
    role?: "radiogroup";
    children: React.ReactNode;
};

export const SettingsSection = ({ title, role, children }: SettingsSectionProps) => (
    <section>
        <h2 className="text-muted-foreground pt-6 pb-2 text-sm font-medium tracking-widest uppercase">{title}</h2>
        <div className="-mx-4 divide-y border-y" role={role} aria-label={role && title}>
            {children}
        </div>
    </section>
);

type RowTextProps = { icon?: LucideIcon; title: string; description?: React.ReactNode };

const RowText = ({ icon: Icon, title, description }: RowTextProps) => (
    <>
        {Icon && <Icon className="text-muted-foreground h-7 w-7 shrink-0" aria-hidden />}
        <div className="flex min-w-0 flex-col">
            <span className="text-xl">{title}</span>
            {description && <span className="text-muted-foreground text-base">{description}</span>}
        </div>
    </>
);

/** A row with its controls on the right. */
export const SettingsRow = ({ children, className, ...text }: RowTextProps & { children?: React.ReactNode; className?: string }) => (
    <div className={cn(ROW, "py-3", className)}>
        <RowText {...text} />
        {children && <div className="ml-auto flex shrink-0 items-center gap-3">{children}</div>}
    </div>
);

/** A row that opens a subpage. */
export const SettingsLinkRow = ({
    to,
    value,
    className,
    ...text
}: RowTextProps & { to: string; value?: React.ReactNode; className?: string }) => (
    <Link
        to={to}
        className={cn(
            ROW,
            "active:bg-accent focus-visible:ring-ring py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
            className
        )}
    >
        <RowText {...text} />
        <span className="text-muted-foreground ml-auto truncate text-lg">{value}</span>
        <ChevronRight className="text-muted-foreground h-7 w-7 shrink-0" aria-hidden />
    </Link>
);

type SettingsRadioRowProps = RowTextProps & {
    checked: boolean;
    onSelect: () => void;
    disabled?: boolean;
    /** Badges shown before the radio mark. */
    children?: React.ReactNode;
};

/** One choice of a list; put the rows in a SettingsSection with role="radiogroup". */
export const SettingsRadioRow = ({ checked, onSelect, disabled, children, ...text }: SettingsRadioRowProps) => (
    <button
        type="button"
        role="radio"
        aria-checked={checked}
        disabled={disabled}
        onClick={onSelect}
        className={cn(
            ROW,
            "active:bg-accent focus-visible:ring-ring w-full py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset disabled:opacity-50",
            checked && "bg-accent"
        )}
    >
        <RowText {...text} />
        <span className="ml-auto flex shrink-0 items-center gap-3">
            {children}
            <span
                className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2",
                    checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50"
                )}
                aria-hidden
            >
                {checked && <Check className="h-5 w-5" strokeWidth={3} />}
            </span>
        </span>
    </button>
);

/** A small label next to a row's title or value, e.g. "In use". */
export const RowBadge = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={cn("text-muted-foreground rounded-md border px-2 py-0.5 text-base", className)}>{children}</span>
);

/** How a release relates to the version on the device; nothing while that version is unknown. */
export const VersionBadge = ({ tag, currentVersion }: { tag: string; currentVersion: string | null | undefined }) => {
    if (!currentVersion) return null;
    const diff = semverCompare(tag, currentVersion);
    if (diff === 0) return <RowBadge>installed</RowBadge>;
    if (diff > 0) return <RowBadge className="border-green-500 text-green-500">upgrade</RowBadge>;
    return <RowBadge className="border-orange-400 text-orange-400">downgrade</RowBadge>;
};

/** A centred message filling the page, for loading, empty and finished states. */
export const Status = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" role="status">
        {children}
    </div>
);

type SettingsSwitchRowProps = RowTextProps & {
    id: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
};

/** A switch whose whole row is the touch target. */
export const SettingsSwitchRow = ({ id, checked, onCheckedChange, disabled, ...text }: SettingsSwitchRowProps) => (
    <label htmlFor={id} className={cn(ROW, "active:bg-accent cursor-pointer py-3 transition-colors", disabled && "cursor-not-allowed opacity-50")}>
        <RowText {...text} />
        <Switch id={id} className="ml-auto" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </label>
);

type SettingsSliderRowProps = {
    icon?: LucideIcon;
    title: string;
    unit: string;
    value: number;
    min: number;
    max: number;
    step: number;
    /** Called once the finger lifts, not on every step. */
    onCommit: (value: number) => void;
    /** Shown below the slider, e.g. a warning about the chosen value. */
    children?: (value: number) => React.ReactNode;
};

export const SettingsSliderRow = ({ icon, title, unit, value, min, max, step, onCommit, children }: SettingsSliderRowProps) => {
    const [live, setLive] = useState(value);

    useEffect(() => setLive(value), [value]);

    return (
        <div className="flex flex-col gap-1 px-4 py-4">
            <div className="flex items-center gap-5">
                <RowText icon={icon} title={title} />
                <span className="ml-auto font-mono text-3xl font-semibold tabular-nums">
                    {live} <span className="text-muted-foreground font-sans text-base font-normal">{unit}</span>
                </span>
            </div>
            <Slider
                aria-label={title}
                value={[live]}
                onValueChange={(v) => setLive(v[0])}
                onValueCommit={(v) => onCommit(v[0])}
                min={min}
                max={max}
                step={step}
            />
            {children?.(live)}
        </div>
    );
};

type SegmentedControlProps<T extends string> = {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onValueChange: (value: T) => void;
};

/** Picks one of a few values; the selected one is filled so it reads at a glance. */
export const SegmentedControl = <T extends string>({ label, value, options, onValueChange }: SegmentedControlProps<T>) => (
    <ToggleGroup
        type="single"
        aria-label={label}
        value={value}
        // Radix reports "" when the selected item is tapped again; keep the selection.
        onValueChange={(v) => v && onValueChange(v as T)}
        className="bg-muted gap-1 rounded-lg p-1"
    >
        {options.map((o) => (
            <ToggleGroupItem
                key={o.value}
                value={o.value}
                className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground h-12 min-w-24 px-5 text-lg"
            >
                {o.label}
            </ToggleGroupItem>
        ))}
    </ToggleGroup>
);
