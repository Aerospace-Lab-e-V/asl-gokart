import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, Download, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Subpage } from "@/components/shared/subpage";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingsSwitchRow } from "@/components/settings/settings-list";
import {
    ConfirmStep,
    DownloadStep,
    ErrorStep,
    InstallStep,
    ReleaseList,
    SuccessStep,
} from "@/components/settings/app-update-steps";
import { type AppRelease, type UpdateProgress, UpdatePhase } from "@/data/updater/updater-types";
import { updater } from "@/services/updater";
import { useApp } from "@/stores/app";
import { getShowPrereleases, setShowPrereleases, visibleReleases } from "@/lib/releases";
import log from "@/lib/logger";

const BUTTON = "h-14 px-8 text-lg";

const AppUpdatePage = () => {
    const navigate = useNavigate();

    const currentVersion = useApp((state) => state.version);
    const [releases, setReleases] = useState<AppRelease[] | null>(null);
    const [releasesError, setReleasesError] = useState<string | null>(null);
    const [selectedRelease, setSelectedRelease] = useState<AppRelease | null>(null);

    const [phase, setPhase] = useState<UpdatePhase>(UpdatePhase.Idle);
    const [installError, setInstallError] = useState<string | null>(null);
    const [progress, setProgress] = useState<UpdateProgress | null>(null);
    const [sudoConfirmed, setSudoConfirmed] = useState(false);
    const [showPre, setShowPre] = useState(() => getShowPrereleases(currentVersion));

    const progressCleanupRef = useRef<(() => void) | null>(null);

    const isBusy = phase === UpdatePhase.Downloading || phase === UpdatePhase.Installing;

    useEffect(() => {
        const load = async () => {
            try {
                setReleases(await updater.getReleases());
            } catch (err) {
                log.error("[AppUpdatePage] Failed to load:", err);
                setReleasesError(err instanceof Error ? err.message : "Failed to fetch releases");
            }
        };
        load();

        return () => {
            progressCleanupRef.current?.();
            progressCleanupRef.current = null;
        };
    }, []);

    const handleInstall = async () => {
        if (!selectedRelease) return;

        setInstallError(null);
        setProgress(null);
        setPhase(UpdatePhase.Downloading);

        progressCleanupRef.current?.();
        progressCleanupRef.current = updater.onProgress(setProgress);

        try {
            await updater.install(selectedRelease.tag);

            progressCleanupRef.current?.();
            progressCleanupRef.current = null;

            setPhase(UpdatePhase.Installing);

            // Slight delay so "Installing…" is visible before dpkg completes
            await new Promise((r) => setTimeout(r, 600));

            setPhase(UpdatePhase.Success);
            toast.success(`Headunit updated to ${selectedRelease.tag}`);
        } catch (err) {
            progressCleanupRef.current?.();
            progressCleanupRef.current = null;

            const msg = err instanceof Error ? err.message : "Update failed";
            log.error("[AppUpdatePage] Install failed:", err);
            setInstallError(msg);
            setPhase(UpdatePhase.Error);
            toast.error(`Update failed: ${msg}`);
        }
    };

    const relaunch = () =>
        updater.relaunch().catch((err) => {
            log.error("[AppUpdatePage] Relaunch failed:", err);
            toast.error(`Restart failed: ${err instanceof Error ? err.message : err}`);
        });

    const toggleShowPre = (show: boolean) => {
        setShowPrereleases(show);
        setShowPre(show);
        if (!show && selectedRelease?.isPrerelease) setSelectedRelease(null);
    };

    const backToList = () => {
        setPhase(UpdatePhase.Idle);
        setInstallError(null);
        setProgress(null);
        setSudoConfirmed(false);
    };

    const body = () => {
        switch (phase) {
            case UpdatePhase.Confirming:
                return (
                    selectedRelease && (
                        <ConfirmStep
                            release={selectedRelease}
                            sudoConfirmed={sudoConfirmed}
                            onSudoConfirmedChange={setSudoConfirmed}
                        />
                    )
                );
            case UpdatePhase.Downloading:
                return selectedRelease && <DownloadStep release={selectedRelease} progress={progress} />;
            case UpdatePhase.Installing:
                return <InstallStep />;
            case UpdatePhase.Success:
                return selectedRelease && <SuccessStep release={selectedRelease} />;
            case UpdatePhase.Error:
                return <ErrorStep error={installError} />;
            default:
                return (
                    <>
                        <SettingsSection title="Channel">
                            <SettingsSwitchRow
                                id="show-prereleases"
                                title="Show pre-releases"
                                description="Alpha, beta and release candidate builds for testing"
                                checked={showPre}
                                onCheckedChange={toggleShowPre}
                            />
                        </SettingsSection>
                        <ReleaseList
                            releases={releases && visibleReleases(releases, currentVersion, showPre)}
                            error={releasesError}
                            currentVersion={currentVersion}
                            selected={selectedRelease}
                            onSelect={setSelectedRelease}
                        />
                    </>
                );
        }
    };

    const footer = () => {
        switch (phase) {
            case UpdatePhase.Confirming:
                return (
                    <>
                        <Button variant="ghost" className={`mr-auto ${BUTTON}`} onClick={backToList}>
                            <ChevronLeft className="mr-1 h-6 w-6" />
                            Releases
                        </Button>
                        <Button className={BUTTON} disabled={!sudoConfirmed} onClick={handleInstall}>
                            <Download className="mr-2 h-5 w-5" />
                            Confirm and install
                        </Button>
                    </>
                );
            case UpdatePhase.Downloading:
            case UpdatePhase.Installing:
                return (
                    <Button className={BUTTON} disabled>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        {phase === UpdatePhase.Downloading ? "Downloading…" : "Installing…"}
                    </Button>
                );
            case UpdatePhase.Success:
                return (
                    <>
                        <Button variant="outline" className={BUTTON} onClick={() => navigate("/settings")}>
                            Later
                        </Button>
                        <Button className={BUTTON} onClick={relaunch}>
                            <RefreshCw className="mr-2 h-5 w-5" />
                            Restart now
                        </Button>
                    </>
                );
            case UpdatePhase.Error:
                return (
                    <Button variant="outline" className={BUTTON} onClick={backToList}>
                        <RotateCcw className="mr-2 h-5 w-5" />
                        Try again
                    </Button>
                );
            default:
                return (
                    <Button
                        className={BUTTON}
                        disabled={!selectedRelease}
                        onClick={() => setPhase(UpdatePhase.Confirming)}
                    >
                        <Download className="mr-2 h-5 w-5" />
                        {selectedRelease ? `Install ${selectedRelease.tag}` : "Select a release"}
                    </Button>
                );
        }
    };

    return (
        <Subpage
            title="App update"
            description={currentVersion && <>Installed: <span className="font-mono">v{currentVersion}</span></>}
            backTo="/settings"
            backDisabled={isBusy}
            footer={footer()}
        >
            {body()}
        </Subpage>
    );
};

export default AppUpdatePage;
