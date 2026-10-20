import React from "react";
import { useShallow } from "zustand/react/shallow";
import { Subpage } from "@/components/shared/subpage";
import { SettingsSection, SettingsSliderRow } from "@/components/settings/settings-list";
import { useStore } from "@/stores/useStore";

const DrivetrainPage = () => {
    const {
        maxSettableSpeed,
        minSettableSpeed,
        setMaxSettableSpeed,
        setMinSettableSpeed,
    } = useStore(
        useShallow((state) => ({
            maxSettableSpeed: state.maxSettableSpeed,
            minSettableSpeed: state.minSettableSpeed,
            setMaxSettableSpeed: state.setMaxSettableSpeed,
            setMinSettableSpeed: state.setMinSettableSpeed,
        }))
    );

    return (
        <Subpage title="Drivetrain" description="Limits the driver can choose from" backTo="/settings">
            <SettingsSection title="Speed limits">
                <SettingsSliderRow
                    title="Max. settable speed"
                    unit="km/h"
                    value={maxSettableSpeed}
                    min={0}
                    max={120}
                    step={5}
                    onCommit={setMaxSettableSpeed}
                >
                    {(speed) =>
                        speed === 0 && <p className="text-lg text-red-500">The kart won't drive in this configuration!</p>
                    }
                </SettingsSliderRow>
                <SettingsSliderRow
                    title="Min. settable speed"
                    unit="km/h"
                    value={minSettableSpeed}
                    min={0}
                    max={120}
                    step={5}
                    onCommit={setMinSettableSpeed}
                />
            </SettingsSection>
        </Subpage>
    );
};

export default DrivetrainPage;
