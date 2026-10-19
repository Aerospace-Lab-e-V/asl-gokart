import React from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { RowBadge, SettingsRadioRow, SettingsSection } from "@/components/settings/settings-list";
import { type AppRelease, type UpdateProgress } from "@/data/updater/updater-types";
import { cn } from "@/lib/utils";

/* The steps of the App update page, one per update phase. */

export const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });

const semverCompare = (a: string, b: string): number => {
    const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
    const [aMaj, aMin, aPat] = parse(a);
    const [bMaj, bMin, bPat] = parse(b);
    return aMaj !== bMaj ? aMaj - bMaj : aMin !== bMin ? aMin - bMin : aPat - bPat;
};

const VersionBadge = ({ tag, currentVersion }: { tag: string; currentVersion: string | null }) => {
    if (!currentVersion) return null;
    const diff = semverCompare(tag, currentVersion);
    if (diff === 0) return <RowBadge>installed</RowBadge>;
    if (diff > 0) return <RowBadge className="border-green-500 text-green-500">upgrade</RowBadge>;
    return <RowBadge className="border-orange-400 text-orange-400">downgrade</RowBadge>;
};

/** A centred message filling the page, for the steps that only report progress. */
const Status = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" role="status">
        {children}
    </div>
);

type ReleaseListProps = {
    releases: AppRelease[] | null;
    error: string | null;
    currentVersion: string | null;
    selected: AppRelease | null;
    onSelect: (release: AppRelease) => void;
};

export const ReleaseList = ({ releases, error, currentVersion, selected, onSelect }: ReleaseListProps) => {
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
                <p className="text-muted-foreground text-xl">No releases found for this architecture</p>
            </Status>
        );
    }
    return (
        <SettingsSection title="Available releases" role="radiogroup">
            {releases.map((release) => (
                <SettingsRadioRow
                    key={release.tag}
                    title={release.tag}
                    description={`${formatDate(release.publishedAt)} · ${formatBytes(release.assetSize)}`}
                    checked={selected?.tag === release.tag}
                    onSelect={() => onSelect(release)}
                >
                    {release.isPrerelease && <RowBadge className="border-yellow-500 text-yellow-500">pre-release</RowBadge>}
                    <VersionBadge tag={release.tag} currentVersion={currentVersion} />
                </SettingsRadioRow>
            ))}
        </SettingsSection>
    );
};

type ConfirmStepProps = {
    release: AppRelease;
    sudoConfirmed: boolean;
    onSudoConfirmedChange: (confirmed: boolean) => void;
};

export const ConfirmStep = ({ release, sudoConfirmed, onSudoConfirmedChange }: ConfirmStepProps) => (
    <div className="flex flex-col gap-4 pt-4">
        <div className="flex items-start gap-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-5 py-4">
            <AlertTriangle className="mt-0.5 h-7 w-7 shrink-0 text-yellow-500" />
            <p className="text-lg">
                Installing <span className="font-mono font-semibold">{release.tag}</span> (
                {formatBytes(release.assetSize)}, {formatDate(release.publishedAt)}). The app restarts afterwards.{" "}
                <span className="font-semibold">Do not power off the kart while it installs.</span>
            </p>
        </div>

        <label
            htmlFor="sudo-confirm"
            className={cn(
                "flex cursor-pointer items-start gap-4 rounded-lg border-2 px-5 py-4 transition-colors select-none active:bg-accent",
                sudoConfirmed && "border-primary"
            )}
        >
            <Checkbox
                id="sudo-confirm"
                checked={sudoConfirmed}
                onCheckedChange={(v) => onSudoConfirmedChange(v === true)}
                className="mt-0.5 h-7 w-7 rounded-md [&_svg]:h-5 [&_svg]:w-5"
            />
            <span className="text-muted-foreground text-lg leading-snug">
                <span className="text-foreground font-mono">sudo</span> runs without a password on this system,{" "}
                <em>or</em> the app was started from a terminal (<span className="text-foreground font-mono">headunit</span>)
                so a password prompt can appear. Otherwise the <span className="font-mono">dpkg</span> step fails silently.
            </span>
        </label>
    </div>
);

export const DownloadStep = ({ release, progress }: { release: AppRelease; progress: UpdateProgress | null }) => {
    const pct = progress?.percent ?? -1;
    const indeterminate = pct < 0;
    return (
        <Status>
            <p className="text-2xl">
                Downloading <span className="font-mono font-semibold">{release.tag}</span>…
            </p>
            <Progress value={indeterminate ? undefined : pct} className={cn("h-4 max-w-xl", indeterminate && "animate-pulse")} />
            {progress && !indeterminate && (
                <p className="text-muted-foreground text-lg tabular-nums">
                    {pct}% — {formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.totalBytes)}
                </p>
            )}
        </Status>
    );
};

export const InstallStep = () => (
    <Status>
        <Loader2 className="text-muted-foreground h-10 w-10 animate-spin" />
        <p className="text-2xl">Installing the package with dpkg…</p>
        <p className="text-lg text-yellow-500">Do not power off the kart</p>
    </Status>
);

export const SuccessStep = ({ release }: { release: AppRelease }) => (
    <Status>
        <CheckCircle2 className="h-14 w-14 text-green-500" />
        <p className="text-2xl font-medium">Installation complete</p>
        <p className="text-muted-foreground text-lg">
            Restart the app to run <span className="text-foreground font-mono">{release.tag}</span>.
        </p>
    </Status>
);

export const ErrorStep = ({ error }: { error: string | null }) => (
    <Status>
        <XCircle className="h-14 w-14 text-red-500" />
        <p className="text-2xl font-medium">Installation failed</p>
        {error && <p className="max-w-2xl font-mono text-base break-all text-red-500">{error}</p>}
    </Status>
);
