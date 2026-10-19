import React, { useEffect } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { Subpage } from "@/components/shared/subpage";
import { SegmentedControl, SettingsRow, SettingsSection, SettingsSwitchRow } from "@/components/settings/settings-list";
import { useStore } from "@/stores/useStore";
import log, { setRendererLogLevel, type LogLevel } from "@/lib/logger";

const LOG_LEVELS: { value: LogLevel; label: string }[] = [
    { value: "error", label: "Error" },
    { value: "warn", label: "Warn" },
    { value: "info", label: "Info" },
    { value: "debug", label: "Debug" },
];

/** Applies a startup option in the main process and stores what it reports back. */
const applyOption = (name: string, set: (enabled: boolean) => Promise<boolean>, store: (enabled: boolean) => void) =>
    (enabled: boolean) =>
        set(enabled)
            .then((result) => {
                store(result);
                toast(`${name} ${result ? "enabled" : "disabled"}!`);
            })
            .catch((e) => {
                log.error(e);
                toast.error(`Failed to change ${name}!`);
            });

const SystemPage = () => {
    const {
        logLevel,
        autoStart,
        fullscreenOnStartup,
        devToolsEnabled,
        setLogLevel,
        setAutoStart,
        setFullscreenOnStartup,
        setDevToolsEnabled,
    } = useStore(
        useShallow((state) => ({
            logLevel: state.logLevel,
            autoStart: state.autoStart,
            fullscreenOnStartup: state.fullscreenOnStartup,
            devToolsEnabled: state.devToolsEnabled,
            setLogLevel: state.setLogLevel,
            setAutoStart: state.setAutoStart,
            setFullscreenOnStartup: state.setFullscreenOnStartup,
            setDevToolsEnabled: state.setDevToolsEnabled,
        }))
    );

    useEffect(() => {
        const fetchOption = async (get: () => Promise<boolean>, store: (enabled: boolean) => void) => {
            try {
                store(await get());
            } catch (e) {
                log.error(e);
            }
        };
        fetchOption(window.app.getAutoStart, setAutoStart);
        fetchOption(window.app.getFullscreenOnStartup, setFullscreenOnStartup);
        fetchOption(window.app.getDevToolsEnabled, setDevToolsEnabled);
    }, [setAutoStart, setFullscreenOnStartup, setDevToolsEnabled]);

    const handleLogLevelChange = async (level: LogLevel) => {
        setLogLevel(level);
        setRendererLogLevel(level);
        await window.app.setLogLevel(level);
        toast(`Log level set to ${level}`);
        log.info(`Log level changed to: ${level}`);
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
                    onCheckedChange={applyOption("Auto-start", window.app.setAutoStart, setAutoStart)}
                />
                <SettingsSwitchRow
                    id="fullscreen-on-startup"
                    title="Start in fullscreen"
                    checked={fullscreenOnStartup}
                    onCheckedChange={applyOption("Start in fullscreen", window.app.setFullscreenOnStartup, setFullscreenOnStartup)}
                />
                <SettingsSwitchRow
                    id="devtools-enabled"
                    title="Developer tools"
                    checked={devToolsEnabled}
                    onCheckedChange={applyOption("Developer tools", window.app.setDevToolsEnabled, setDevToolsEnabled)}
                />
            </SettingsSection>
        </Subpage>
    );
};

export default SystemPage;
