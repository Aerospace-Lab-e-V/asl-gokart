import { create } from "zustand";
import type { Command, CommandType } from "@/domain/commands";

/*
 * The last value sent for settings the ECU does not echo (welcome color, brightness). Shown as
 * "last sent", never as the ECU's state; empty after a restart, so the UI shows "unknown".
 * Only `services/commands.ts` writes it.
 */
export type SentCommands = Partial<{ [K in CommandType]: Extract<Command, { type: K }> }>;

export const useSent = create<SentCommands>(() => ({}));
