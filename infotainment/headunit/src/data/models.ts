import { LucideIcon } from "lucide-react";

export interface NavBarItemData {
  Icon: LucideIcon;
  label: string;
  linkTo: string;
  /** Other routes that keep this item highlighted, e.g. pages reached from it. */
  alsoActiveOn?: string[];
}

export interface ValueCardProps {
  label: string;
  value: string | number;
  unit?: string;
}

export interface BatteryIndicatorProps {
  /** Percent 0-100; null shows "--". */
  batteryLevel: number | null;
}