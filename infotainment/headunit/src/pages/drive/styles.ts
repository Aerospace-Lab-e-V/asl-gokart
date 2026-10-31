import type React from "react";
import ClassicDrive from "./classic";

/*
 * The looks the Drive page can take.
 * To add a style: add its id here, a page under pages/drive/ and an entry below. Parts several styles
 * show (lamps, light row, gear row, ...) live in components/drive/. The BulbCheck context is provided
 * by the Drive page, so a style only renders its layout.
 */

export type DriveStyleId = "classic";

interface DriveStyle {
    label: string;
    /** One line in the style picker. */
    description: string;
    Page: React.ComponentType;
}

export const DRIVE_STYLES: Record<DriveStyleId, DriveStyle> = {
    classic: { label: "Classic", description: "Speed with throttle and RPM gauges, temperatures below", Page: ClassicDrive },
};
