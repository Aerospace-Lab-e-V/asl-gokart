import { LucideIcon } from "lucide-react";

export interface NavBarItemData {
  Icon: LucideIcon;
  label: string;
  linkTo: string;
}

export interface ValueCardProps {
  label: string;
  value: string | number;
  unit?: string;
}

export interface BatteryIndicatorProps {
  batteryLevel: number;
}