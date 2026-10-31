import React from "react";
import { BulbCheck } from "@/components/drive/warning-lamps";
import { DriveStylePicker } from "@/components/drive/drive-style-picker";
import { useBulbCheck } from "@/hooks/use-bulb-check";
import { useSession } from "@/stores/session";
import { DRIVE_STYLES } from "./styles";

/** The Drive page in the style the driver picked; the bulb check runs here, so switching styles does not cut it short. */
const DrivePage = () => {
    const { Page } = DRIVE_STYLES[useSession((state) => state.driveStyle)];
    const checking = useBulbCheck();
    return (
        <BulbCheck.Provider value={checking}>
            <Page />
            <DriveStylePicker />
        </BulbCheck.Provider>
    );
};

export default DrivePage;
