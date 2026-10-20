import { StateCreator } from 'zustand'
import { MotorSlice } from './motorSlice'
import { calculateFlowState } from '@/lib/utils/flow-state'
import { BATTERY_MIN_VOLTAGE, BATTERY_MAX_VOLTAGE } from '@/data/battery-config'

export interface BatterySlice {
    batteryTemps: number[],
    avgBatteryTemp: number,
    minTemp: number,
    maxTemp: number,
    batteryPercentage: number,
    voltage: number,
    batteryCurrent: number,
    setBatteryTemps: (temps: number[]) => void,
    setBatteryVoltage: (voltage: number) => void,
    setBatteryCurrent: (current: number) => void,
  }
  
export const createBatterySlice: StateCreator<
    BatterySlice & MotorSlice,
    [],
    [],
    BatterySlice
  > = (set, get) => ({
    batteryTemps: [30, 35, 20, 25, 20, 20],
    avgBatteryTemp: 0,
    minTemp: 0,
    maxTemp: 0,
    batteryPercentage: 0.33,
    voltage: 67.2,
    batteryCurrent: 95,
    setBatteryTemps: (temps: number[]) => set(() => {
      const avgBatteryTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
      const minTemp = Math.min(...temps);
      const maxTemp = Math.max(...temps);
      return {
        batteryTemps: temps,
        avgBatteryTemp,
        minTemp,
        maxTemp
      };
    }),
    setBatteryVoltage: (voltage: number) => set(() => {
      const batteryPercentage = (voltage - BATTERY_MIN_VOLTAGE) / (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE);
      return { 
        voltage: voltage,
        batteryPercentage: batteryPercentage };
    }),
    setBatteryCurrent: (current: number) => {
      const throttle = get().throttle;
      const rpm = get().rpm;
      const debugOverride = get().debugFlowStateOverride;
      set({ 
        batteryCurrent: current,
        flowState: debugOverride ?? calculateFlowState(current, throttle, rpm)
      });
    }
  })