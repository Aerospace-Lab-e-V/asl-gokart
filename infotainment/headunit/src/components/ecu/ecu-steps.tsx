import React from "react";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
    RowBadge,
    SettingsRadioRow,
    SettingsSection,
    Status,
    VersionBadge,
} from "@/components/settings/settings-list";
import { EcuDefinition, EcuPresence, FirmwareRelease } from "@/data/ecu/ecu-types";
import { formatDate } from "@/lib/releases";
import { cn } from "@/lib/utils";

/* The parts of the ECU Manager: the live status of a controller and the steps of a flash. */

/** "● Online · 192.168.1.21", "● Offline", or "Checking…" before the first status arrives. */
export const EcuStatusLine = ({ presence }: { presence: EcuPresence | undefined }) => {
    if (!presence) return <>Checking…</>;
    return (
        <span className="inline-flex items-center gap-2">
            <span
                className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    presence.online ? "bg-green-500" : "bg-muted-foreground/40"
                )}
                aria-hidden
            />
            {presence.online ? `Online · ${presence.ip}` : "Offline"}
        </span>
    );
};

type ReleaseListProps = {
    releases: FirmwareRelease[] | null;
    error: string | null;
    cachedTags: string[];
    lastFlashed: string | undefined;
    selected: FirmwareRelease | null;
    onSelect: (release: FirmwareRelease) => void;
};

export const ReleaseList = ({
    releases,
    error,
    cachedTags,
    lastFlashed,
    selected,
    onSelect,
}: ReleaseListProps) => {
    if (error) {
        return (
            <Status>
                <XCircle className="h-14 w-14 text-red-500" />
                <p className="text-2xl font-medium">Could not fetch the releases</p>
                <p className="text-muted-foreground text-lg">{error}</p>
            </Status>
        );
    }
    if (!releases) {
        return (
            <Status>
                <Loader2 className="text-muted-foreground h-10 w-10 animate-spin" />
                <p className="text-muted-foreground text-xl">Fetching releases…</p>
            </Status>
        );
    }
    if (releases.length === 0) {
        return (
            <Status>
                <p className="text-muted-foreground text-xl">
                    No releases contain firmware for this controller
                </p>
            </Status>
        );
    }
    return (
        <SettingsSection title="Available releases" role="radiogroup">
            {releases.map((release) => (
                <SettingsRadioRow
                    key={release.tag}
                    title={release.tag}
                    description={formatDate(release.publishedAt)}
                    checked={selected?.tag === release.tag}
                    onSelect={() => onSelect(release)}
                >
                    {release.isPrerelease && (
                        <RowBadge className="border-yellow-500 text-yellow-500">
                            pre-release
                        </RowBadge>
                    )}
                    {cachedTags.includes(release.tag) && <RowBadge>downloaded</RowBadge>}
                    <VersionBadge tag={release.tag} currentVersion={lastFlashed} />
                </SettingsRadioRow>
            ))}
        </SettingsSection>
    );
};

type ConfirmStepProps = {
    definition: EcuDefinition;
    release: FirmwareRelease;
    lastFlashed: string | undefined;
};

/** The version change in large type, readable while standing next to the kart. */
export const ConfirmStep = ({ definition, release, lastFlashed }: ConfirmStepProps) => (
    <div className="flex flex-1 flex-col justify-center gap-8">
        <div className="flex flex-col items-center gap-3">
            <p className="text-muted-foreground text-xl">Flash the {definition.displayName}</p>
            <div className="flex items-center gap-5 font-mono text-4xl font-semibold">
                <span className={cn(!lastFlashed && "text-muted-foreground")}>
                    {lastFlashed ?? "unknown"}
                </span>
                <ArrowRight className="text-muted-foreground h-8 w-8" aria-label="to" />
                <span>{release.tag}</span>
            </div>
            <div className="flex gap-3">
                {release.isPrerelease && (
                    <RowBadge className="border-yellow-500 text-yellow-500">pre-release</RowBadge>
                )}
                <VersionBadge tag={release.tag} currentVersion={lastFlashed} />
            </div>
        </div>

        <div className="mx-auto flex max-w-3xl items-start gap-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-5 py-4">
            <AlertTriangle className="mt-0.5 h-7 w-7 shrink-0 text-yellow-500" />
            <p className="text-lg">
                The controller downloads the firmware from the headunit and restarts, so its
                functions drop out for a few seconds.{" "}
                <span className="font-semibold">Do not power off the kart while it flashes.</span>
            </p>
        </div>
    </div>
);

export enum FlashStep {
    Download,
    Send,
    EcuDownload,
    Reboot,
    Online,
}

/** A flash as the controller page shows it. */
export type FlashRun = {
    tag: string;
    /** The step in progress, the failed one with `error`, or Online once done. */
    step: FlashStep;
    /** The binary was already on the headunit, so the GitHub download was skipped. */
    cached: boolean;
    /** Set while the ECU downloads; undefined while waiting for it to start. */
    percent?: number;
    error?: string;
};

const STEP_TITLES: Record<FlashStep, string> = {
    [FlashStep.Download]: "Download from GitHub",
    [FlashStep.Send]: "Send the update to the ECU",
    [FlashStep.EcuDownload]: "ECU downloads the firmware",
    [FlashStep.Reboot]: "ECU writes it and restarts",
    [FlashStep.Online]: "Back online",
};

type StepState = "done" | "active" | "failed" | "pending";

const StepMark = ({ state }: { state: StepState }) => (
    <span
        className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2",
            state === "done" && "border-green-500 bg-green-500 text-white",
            state === "active" && "border-primary",
            state === "failed" && "border-red-500 bg-red-500 text-white",
            state === "pending" && "border-muted-foreground/30"
        )}
        aria-hidden
    >
        {state === "done" && <Check className="h-6 w-6" strokeWidth={3} />}
        {state === "active" && <Loader2 className="h-6 w-6 animate-spin" />}
        {state === "failed" && <X className="h-6 w-6" strokeWidth={3} />}
    </span>
);

const stepDetail = (step: FlashStep, run: FlashRun, state: StepState): React.ReactNode => {
    if (state === "failed") return <span className="text-red-500">{run.error}</span>;
    if (step === FlashStep.Download && run.cached) return "Already on the headunit";
    if (state !== "active") return null;
    switch (step) {
        case FlashStep.EcuDownload:
            return run.percent === undefined ? "Waiting for the ECU to start…" : `${run.percent}%`;
        case FlashStep.Reboot:
            return "Usually takes a few seconds";
        default:
            return null;
    }
};

/** The steps of a flash with their progress; the failed step carries the error. */
export const FlashSteps = ({ run }: { run: FlashRun }) => (
    <ol className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-5 py-4">
        {Object.values(FlashStep)
            .filter((s): s is FlashStep => typeof s === "number")
            .map((step) => {
                const state: StepState =
                    step < run.step ||
                    (step === run.step && step === FlashStep.Online && !run.error)
                        ? "done"
                        : step > run.step
                          ? "pending"
                          : run.error
                            ? "failed"
                            : "active";
                const detail = stepDetail(step, run, state);
                return (
                    <li key={step} className="flex items-start gap-5">
                        <StepMark state={state} />
                        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1.5">
                            <span
                                className={cn(
                                    "text-xl",
                                    state === "pending" && "text-muted-foreground"
                                )}
                            >
                                {STEP_TITLES[step]}
                            </span>
                            {detail && (
                                <span className="text-muted-foreground text-base break-words">
                                    {detail}
                                </span>
                            )}
                            {step === FlashStep.EcuDownload &&
                                state === "active" &&
                                run.percent !== undefined && (
                                    <Progress value={run.percent} className="h-3" />
                                )}
                        </div>
                    </li>
                );
            })}
    </ol>
);

export const SuccessStep = ({ definition, tag }: { definition: EcuDefinition; tag: string }) => (
    <Status>
        <CheckCircle2 className="h-14 w-14 text-green-500" />
        <p className="text-2xl font-medium">{definition.displayName} is back online</p>
        <p className="text-muted-foreground text-lg">
            Running <span className="text-foreground font-mono">{tag}</span>
        </p>
    </Status>
);
