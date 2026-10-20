import React, { useEffect, useState } from "react";
import { CircuitBoard } from "lucide-react";
import { Subpage } from "@/components/shared/subpage";
import { SettingsLinkRow, SettingsSection } from "@/components/settings/settings-list";
import { EcuStatusLine } from "@/components/ecu/ecu-steps";
import { ECU_DEFINITIONS } from "@/data/ecu/ecu-definitions";
import { FlashHistory } from "@/data/ecu/ecu-types";
import { useEcuStatus } from "@/hooks/useEcuStatus";
import { firmware } from "@/services/firmware";
import log from "@/lib/logger";

const EcuManagerPage = () => {
    const status = useEcuStatus();
    const [history, setHistory] = useState<FlashHistory>({});

    useEffect(() => {
        firmware
            .getFlashHistory()
            .then(setHistory)
            .catch((err) => log.error("[EcuManagerPage] Failed to load the flash history:", err));
    }, []);

    return (
        <Subpage
            title="ECU Manager"
            description="Flash firmware to the zone controllers over LAN"
            backTo="/settings"
        >
            <SettingsSection title="Zone controllers">
                {ECU_DEFINITIONS.map((def) => {
                    const tag = history[def.id]?.tag;
                    return (
                        <SettingsLinkRow
                            key={def.id}
                            to={`/ecu-manager/${def.id}`}
                            icon={CircuitBoard}
                            title={def.displayName}
                            description={<EcuStatusLine presence={status?.[def.id]} />}
                            value={
                                tag ? (
                                    <span className="text-foreground font-mono">{tag}</span>
                                ) : (
                                    "Unknown"
                                )
                            }
                        />
                    );
                })}
            </SettingsSection>
            <p className="text-muted-foreground py-6 text-center text-base">
                Versions are the last ones flashed from this headunit.
            </p>
        </Subpage>
    );
};

export default EcuManagerPage;
