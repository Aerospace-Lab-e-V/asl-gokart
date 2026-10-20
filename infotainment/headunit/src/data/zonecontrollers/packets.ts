import { BatteryCommands, LightsCommands, MotorCommands, Zones } from "./zonecontrollers"

export interface IncomingPacket {
    zone: Zones,
    identifier?: string,
    command: BatteryCommands | LightsCommands | MotorCommands,
    value: any 
}
