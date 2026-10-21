import { create } from "zustand";
import type { AgentState } from "@/services/kart-agent/schema";

/** kart-agent status as polled by main. Only `services/bridge.ts` writes it. */
export const useAgent = create<AgentState>(() => ({ status: null, error: null }));
