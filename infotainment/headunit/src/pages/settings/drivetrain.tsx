import React from "react";
import { useShallow } from "zustand/react/shallow";
import { Subpage } from "@/components/shared/subpage";
import { Button } from "@/components/ui/button";
import { SettingsRow, SettingsSection, SettingsSliderRow, SettingsSwitchRow } from "@/components/settings/settings-list";
import { useStore } from "@/stores/useStore";
import { OutgoingPacket } from "@/data/zonecontrollers/packets";
import { ThrottleCommands, Zones } from "@/data/zonecontrollers/zonecontrollers";
import log from "@/lib/logger";

const DrivetrainPage = () => {
    const {
        maxSettableSpeed,
        minSettableSpeed,
        pedalMultiplier,
        pipeThroughRawThrottle,
        showRawThrottle,
        setMaxSettableSpeed,
        setMinSettableSpeed,
        setPedalMultiplier,
        setPipeThroughRawThrottle,
        setShowRawThrottle,
    } = useStore(
        useShallow((state) => ({
            maxSettableSpeed: state.maxSettableSpeed,
            minSettableSpeed: state.minSettableSpeed,
            pedalMultiplier: state.pedalMultiplier,
            pipeThroughRawThrottle: state.pipeThroughRawThrottle,
            showRawThrottle: state.showRawThrottle,
            setMaxSettableSpeed: state.setMaxSettableSpeed,
            setMinSettableSpeed: state.setMinSettableSpeed,
            setPedalMultiplier: state.setPedalMultiplier,
            setPipeThroughRawThrottle: state.setPipeThroughRawThrottle,
            setShowRawThrottle: state.setShowRawThrottle,
        }))
    );

    const reconnectUart = () => {
        const packet: OutgoingPacket = {
            zone: Zones.THROTTLE,
            command: ThrottleCommands.SET_RECONNECT_UART,
        };
        log.info(JSON.stringify(packet));
        window.websocket.send(packet, Zones.THROTTLE);
    };

    return (
        <Subpage title="Drivetrain" description="Limits the driver can choose from, and throttle handling" backTo="/settings">
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

            <SettingsSection title="Throttle">
                <SettingsSliderRow
                    title="Pedal multiplier"
                    unit="%"
                    value={pedalMultiplier}
                    min={0}
                    max={100}
                    step={5}
                    onCommit={setPedalMultiplier}
                />
                <SettingsSwitchRow
                    id="pipe-through-raw-throttle"
                    title="Pipe through raw throttle"
                    checked={pipeThroughRawThrottle}
                    onCheckedChange={setPipeThroughRawThrottle}
                />
                <SettingsSwitchRow
                    id="show-raw-throttle"
                    title="Show raw throttle"
                    checked={showRawThrottle}
                    onCheckedChange={setShowRawThrottle}
                />
                <SettingsRow title="Controller UART" description="Tell the throttle zone controller to reconnect its UART">
                    <Button variant="outline" className="h-12 px-6 text-lg" onClick={reconnectUart}>
                        Reconnect
                    </Button>
                </SettingsRow>
            </SettingsSection>
        </Subpage>
    );
};

export default DrivetrainPage;
