/** A selectable gear or drive mode; structurally a TabsSelectorOption, so this file does not import UI. */
interface Option {
    value: string;
    label: string;
    disabled?: boolean;
}

export enum Gears {
    p = "p",
    d = "d",
    n = "n",
    r = "r"
}

export enum DriveModes {
    comfort = "comfort",
    eco = "eco",
    sport = "sport",
    ludicrous = "ludicrous"
}

export const tabsSelectorStates = (): { gears: Option[], driveModes: Option[] } => {
    const gears: Option[] = [
        {value: Gears.p, label: "P"},
        {value: Gears.d, label: "D"}, 
        {value: Gears.n, label: "N"},
        {value: Gears.r, label: "R"}
    ];
    const driveModes: Option[] = [
        {value: DriveModes.eco, label: "Eco"},
        {value: DriveModes.comfort, label: "Comfort"}, 
        {value: DriveModes.sport, label: "Sport"},
        {value: DriveModes.ludicrous, label: "Ludicrous", disabled: false}
    ];
    return {
        gears: gears,
        driveModes: driveModes
    }
}