import React, { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, Download, Loader2, RotateCcw, Zap } from "lucide-react";
import { Subpage } from "@/components/shared/subpage";
import { Button } from "@/components/ui/button";
import {
    ConfirmStep,
    EcuStatusLine,
    FlashRun,
    FlashStep,
    FlashSteps,
    ReleaseList,
    SuccessStep,
} from "@/components/ecu/ecu-steps";
import { ECU_DEFINITIONS } from "@/data/ecu/ecu-definitions";
import {
    EcuDefinition,
    FirmwareRelease,
    FlashHistory,
    OtaPhase,
    OtaProgress,
} from "@/data/ecu/ecu-types";
import { useEcuStatus } from "@/hooks/useEcuStatus";
import { useSignal } from "@/stores/signals";
import { firmware } from "@/services/firmware";
import log from "@/lib/logger";
import { cn } from "@/lib/utils";

const BUTTON = "h-14 px-8 text-lg";

enum Phase {
    Select,
    Confirm,
    Flashing,
    Success,
    Error,
}

const STEP_OF_OTA_PHASE: Record<Exclude<OtaPhase, OtaPhase.Failed>, FlashStep> = {
    [OtaPhase.WaitingForEcu]: FlashStep.EcuDownload,
    [OtaPhase.EcuDownloading]: FlashStep.EcuDownload,
    [OtaPhase.Rebooting]: FlashStep.Reboot,
    [OtaPhase.Online]: FlashStep.Online,
};

/** Applies a progress report of the main process to the run shown on the page. */
const applyProgress = (run: FlashRun, p: OtaProgress): FlashRun => {
    if (p.phase === OtaPhase.Failed) {
        const failed =
            p.failedPhase && p.failedPhase !== OtaPhase.Failed
                ? STEP_OF_OTA_PHASE[p.failedPhase]
                : run.step;
        return { ...run, step: failed, error: p.error };
    }
    return { ...run, step: STEP_OF_OTA_PHASE[p.phase], percent: p.percent };
};

const errorMessage = (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback;

const EcuControllerPage = () => {
    const { id } = useParams();
    const definition = ECU_DEFINITIONS.find((d) => d.id === id);
    return definition ? (
        <EcuController key={definition.id} definition={definition} />
    ) : (
        <Navigate to="/ecu-manager" replace />
    );
};

const EcuController = ({ definition }: { definition: EcuDefinition }) => {
    const navigate = useNavigate();
    const status = useEcuStatus();
    const speed = useSignal("drive.speed");

    const [releases, setReleases] = useState<FirmwareRelease[] | null>(null);
    const [releasesError, setReleasesError] = useState<string | null>(null);
    const [cachedTags, setCachedTags] = useState<string[]>([]);
    const [history, setHistory] = useState<FlashHistory>({});
    const [selected, setSelected] = useState<FirmwareRelease | null>(null);

    const [phase, setPhase] = useState<Phase>(Phase.Select);
    const [run, setRun] = useState<FlashRun | null>(null);
    const [downloadingOnly, setDownloadingOnly] = useState(false);

    const presence = status?.[definition.id];
    const lastFlashed = history[definition.id]?.tag;
    // A hint only: main refuses the flash itself unless it has a fresh zero speed.
    const moving = speed !== null && speed > 0;
    const blockedReason = !presence?.online
        ? "ECU offline"
        : moving
          ? "Stop the kart to flash"
          : null;
    const isCached = !!selected && cachedTags.includes(selected.tag);

    const loadHistory = useCallback(
        () =>
            firmware
                .getFlashHistory()
                .then(setHistory)
                .catch((err) =>
                    log.error("[EcuController] Failed to load the flash history:", err)
                ),
        []
    );

    useEffect(() => {
        const load = async () => {
            try {
                const [fetched, cached, progress] = await Promise.all([
                    firmware.getReleases(definition.id),
                    firmware.getCachedVersions(),
                    firmware.getOtaProgress(definition.id),
                ]);
                setReleases(fetched);
                setCachedTags(cached[definition.id] ?? []);
                // Back on the page while a flash is still running, e.g. after leaving via the sidebar.
                if (progress) {
                    setRun(
                        applyProgress(
                            { tag: progress.tag, step: FlashStep.Send, cached: true },
                            progress
                        )
                    );
                    setPhase(Phase.Flashing);
                }
            } catch (err) {
                log.error("[EcuController] Failed to load:", err);
                setReleasesError(errorMessage(err, "Failed to fetch releases"));
            }
        };
        load();
        loadHistory();
    }, [definition, loadHistory]);

    useEffect(
        () =>
            firmware.onOtaProgress((progress) => {
                if (progress.ecuId !== definition.id) return;
                setRun((current) =>
                    current && current.tag === progress.tag
                        ? applyProgress(current, progress)
                        : current
                );
                if (progress.phase === OtaPhase.Online) {
                    setPhase(Phase.Success);
                    loadHistory();
                    toast.success(`${definition.displayName} is back online on ${progress.tag}`);
                } else if (progress.phase === OtaPhase.Failed) {
                    setPhase(Phase.Error);
                    toast.error(`Flashing the ${definition.displayName} failed`);
                }
            }),
        [definition, loadHistory]
    );

    const download = async (release: FirmwareRelease) => {
        await firmware.download(definition.id, release.tag);
        setCachedTags((tags) => [...tags, release.tag]);
    };

    const handleDownloadOnly = async () => {
        if (!selected) return;
        setDownloadingOnly(true);
        try {
            await download(selected);
            toast.success(`${selected.tag} is ready to flash`);
        } catch (err) {
            log.error("[EcuController] Download failed:", err);
            toast.error(`Download failed: ${errorMessage(err, "unknown error")}`);
        } finally {
            setDownloadingOnly(false);
        }
    };

    const handleFlash = async () => {
        if (!selected) return;
        const release = selected;
        setRun({
            tag: release.tag,
            step: isCached ? FlashStep.Send : FlashStep.Download,
            cached: isCached,
        });
        setPhase(Phase.Flashing);

        let step = FlashStep.Download;
        try {
            if (!isCached) {
                await download(release);
                setRun((r) => r && { ...r, step: FlashStep.Send });
            }
            step = FlashStep.Send;
            // Main refuses (and rejects with why) while the kart moves or admin mode is locked.
            // From here the main process reports the progress (onOtaProgress).
            await firmware.triggerOta(definition.id, release.tag);
        } catch (err) {
            log.error("[EcuController] Flash failed:", err);
            setRun((r) => r && { ...r, step, error: errorMessage(err, "Flash failed") });
            setPhase(Phase.Error);
            toast.error(`Flashing the ${definition.displayName} failed`);
        }
    };

    const backToReleases = () => {
        setPhase(Phase.Select);
        setRun(null);
    };

    const body = () => {
        switch (phase) {
            case Phase.Confirm:
                return (
                    selected && (
                        <ConfirmStep
                            definition={definition}
                            release={selected}
                            lastFlashed={lastFlashed}
                        />
                    )
                );
            case Phase.Flashing:
            case Phase.Error:
                return run && <FlashSteps run={run} />;
            case Phase.Success:
                return run && <SuccessStep definition={definition} tag={run.tag} />;
            default:
                return (
                    <ReleaseList
                        releases={releases}
                        error={releasesError}
                        cachedTags={cachedTags}
                        lastFlashed={lastFlashed}
                        selected={selected}
                        onSelect={setSelected}
                    />
                );
        }
    };

    const blockedNote = (className?: string) =>
        blockedReason && (
            <span className={cn("text-muted-foreground text-lg", className)}>{blockedReason}</span>
        );

    const footer = () => {
        switch (phase) {
            case Phase.Confirm:
                return (
                    <>
                        <Button
                            variant="ghost"
                            className={`mr-auto ${BUTTON}`}
                            onClick={backToReleases}
                        >
                            <ChevronLeft className="mr-1 h-6 w-6" />
                            Releases
                        </Button>
                        {blockedNote()}
                        <Button className={BUTTON} disabled={!!blockedReason} onClick={handleFlash}>
                            <Zap className="mr-2 h-5 w-5" />
                            Flash now
                        </Button>
                    </>
                );
            case Phase.Flashing:
                return (
                    <Button className={BUTTON} disabled>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Flashing…
                    </Button>
                );
            case Phase.Success:
                return (
                    <Button className={BUTTON} onClick={() => navigate("/ecu-manager")}>
                        Done
                    </Button>
                );
            case Phase.Error:
                return (
                    <Button variant="outline" className={BUTTON} onClick={backToReleases}>
                        <RotateCcw className="mr-2 h-5 w-5" />
                        Try again
                    </Button>
                );
            default:
                return (
                    <>
                        {blockedNote("mr-auto")}
                        {blockedReason && selected && !isCached && (
                            <Button
                                variant="outline"
                                className={BUTTON}
                                disabled={downloadingOnly}
                                onClick={handleDownloadOnly}
                            >
                                {downloadingOnly ? (
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                ) : (
                                    <Download className="mr-2 h-5 w-5" />
                                )}
                                Download only
                            </Button>
                        )}
                        <Button
                            className={BUTTON}
                            disabled={!selected || !!blockedReason || downloadingOnly}
                            onClick={() => setPhase(Phase.Confirm)}
                        >
                            <Zap className="mr-2 h-5 w-5" />
                            {selected ? `Flash ${selected.tag}` : "Select a release"}
                        </Button>
                    </>
                );
        }
    };

    return (
        <Subpage
            title={definition.displayName}
            description={
                <>
                    <EcuStatusLine presence={presence} />
                    <span className="mx-2">·</span>
                    Last flashed from this headunit:{" "}
                    <span className={lastFlashed ? "text-foreground font-mono" : undefined}>
                        {lastFlashed ?? "unknown"}
                    </span>
                </>
            }
            backTo="/ecu-manager"
            backDisabled={phase === Phase.Flashing || downloadingOnly}
            footer={footer()}
        >
            {body()}
        </Subpage>
    );
};

export default EcuControllerPage;
