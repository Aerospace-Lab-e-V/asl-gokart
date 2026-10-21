import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Subpage } from "@/components/shared/subpage";
import { SegmentedControl, SettingsRow, SettingsSection, SettingsSwitchRow } from "@/components/settings/settings-list";
import { app } from "@/services/app";
import log, { setRendererLogLevel, type LogLevel } from "@/lib/logger";

const LOG_LEVELS: { value: LogLevel; label: string }[] = [
    { value: "error", label: "Error" },
    { value: "warn", label: "Warn" },
    { value: "info", label: "Info" },
    { value: "debug", label: "Debug" },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Applies a startup option in the main process and shows what it reports back. */
const applyOption = (name: string, set: (enabled: boolean) => Promise<boolean>, show: (enabled: boolean) => void) =>
    (enabled: boolean) =>
        set(enabled)
            .then((result) => {
                show(result);
                toast(`${name} ${result ? "enabled" : "disabled"}!`);
            })
            .catch((e) => {
                log.error(e);
                toast.error(`Failed to change ${name}: ${errorText(e)}`);
            });

/** Main owns these settings; the page shows what main reports, read on every visit. */
const SystemPage = () => {
    const [logLevel, setLogLevel] = useState<LogLevel>("info");
    const [autoStart, setAutoStart] = useState(false);
    const [fullscreenOnStartup, setFullscreenOnStartup] = useState(false);
    const [devToolsEnabled, setDevToolsEnabled] = useState(false);

    useEffect(() => {
        const fetchOption = async <T,>(get: () => Promise<T>, show: (value: T) => void) => {
            try {
                show(await get());
            } catch (e) {
                log.error(e);
            }
        };
        fetchOption(app.getLogLevel, setLogLevel);
        fetchOption(app.getAutoStart, setAutoStart);
        fetchOption(app.getFullscreenOnStartup, setFullscreenOnStartup);
        fetchOption(app.getDevToolsEnabled, setDevToolsEnabled);
    }, []);

    const handleLogLevelChange = async (level: LogLevel) => {
        try {
            const applied = await app.setLogLevel(level);
            setLogLevel(applied);
            setRendererLogLevel(applied);
            toast(`Log level set to ${applied}`);
            log.info(`Log level changed to: ${applied}`);
        } catch (e) {
            log.error(e);
            toast.error(`Failed to change the log level: ${errorText(e)}`);
        }
    };

    return (
        <Subpage title="System" description="Logging and how the app starts" backTo="/settings">
            <SettingsSection title="Logging">
                <SettingsRow title="Log level">
                    <SegmentedControl label="Log level" value={logLevel} options={LOG_LEVELS} onValueChange={handleLogLevelChange} />
                </SettingsRow>
            </SettingsSection>

            <SettingsSection title="Startup">
                <SettingsSwitchRow
                    id="auto-start"
                    title="Auto-start on boot"
                    checked={autoStart}
                    onCheckedChange={applyOption("Auto-start", app.setAutoStart, setAutoStart)}
                />
                <SettingsSwitchRow
                    id="fullscreen-on-startup"
                    title="Start in fullscreen"
                    checked={fullscreenOnStartup}
                    onCheckedChange={applyOption("Start in fullscreen", app.setFullscreenOnStartup, setFullscreenOnStartup)}
                />
                <SettingsSwitchRow
                    id="devtools-enabled"
                    title="Developer tools"
                    checked={devToolsEnabled}
                    onCheckedChange={applyOption("Developer tools", app.setDevToolsEnabled, setDevToolsEnabled)}
                />
            </SettingsSection>
        </Subpage>
    );
};

export default SystemPage;
