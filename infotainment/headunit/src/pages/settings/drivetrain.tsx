import React from "react";
import { Subpage } from "@/components/shared/subpage";

/*
 * TODO(firmware): zc_throttle WebSocket path removed; re-add when settings move to Sero.
 * The controls that went over it: max/min settable speed, pedal multiplier, pipe-through raw
 * throttle, show raw throttle and the controller UART reconnect (see git history of this file).
 */
const DrivetrainPage = () => (
    <Subpage title="Drivetrain" description="Limits the driver can choose from, and throttle handling" backTo="/settings">
        <p className="text-muted-foreground flex flex-1 items-center justify-center text-xl">
            Not available until the throttle controller talks SERO
        </p>
    </Subpage>
);

export default DrivetrainPage;
