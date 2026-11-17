import React from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SettingsRadioRow, SettingsSection } from "@/components/settings/settings-list";
import { DRIVE_STYLES, type DriveStyleId } from "@/pages/drive/styles";
import { setDriveStyle, setDriveStylePickerOpen, useSession } from "@/stores/session";

/** Sheet beside the navbar listing the drive styles; picking one switches to it and closes the sheet. */
export const DriveStylePicker = () => {
    const open = useSession((state) => state.driveStylePickerOpen);
    const current = useSession((state) => state.driveStyle);

    const pick = (id: DriveStyleId) => {
        setDriveStyle(id);
        setDriveStylePickerOpen(false);
    };

    return (
        <Sheet open={open} onOpenChange={setDriveStylePickerOpen}>
            <SheetContent side="right" aria-describedby={undefined} className="sm:max-w-md">
                {/* The section heading is the visible title. */}
                <SheetTitle className="sr-only">Drive style</SheetTitle>
                <SettingsSection title="Drive style" role="radiogroup">
                    {(Object.keys(DRIVE_STYLES) as DriveStyleId[]).map((id) => (
                        <SettingsRadioRow
                            key={id}
                            title={DRIVE_STYLES[id].label}
                            description={DRIVE_STYLES[id].description}
                            checked={id === current}
                            onSelect={() => pick(id)}
                        />
                    ))}
                </SettingsSection>
            </SheetContent>
        </Sheet>
    );
};
