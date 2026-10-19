import React from "react";
import { Subpage } from "@/components/shared/subpage";
import { ECU_DEFINITIONS } from "@/data/ecu/ecu-definitions";
import { EcuCard } from "@/components/ecu/ecu-card";

const EcuManagerPage = () => (
    <Subpage title="ECU Manager" description="Flash firmware to zone controllers over LAN (OTA)" backTo="/settings">
        <div className="grid grid-cols-2 gap-4 pt-2">
            {ECU_DEFINITIONS.map((def) => (
                <EcuCard key={def.id} definition={def} />
            ))}
        </div>
    </Subpage>
);

export default EcuManagerPage;
