import { Gears, DriveModes } from '@/data/controlling_models/drivetrain'
import { StateCreator } from 'zustand'
import { BatterySlice } from './batterySlice'
import { FlowState, calculateFlowState } from '@/lib/utils/flow-state'

export { FlowState } from '@/lib/utils/flow-state'
import { KellyTelemetry } from '@/data/controlling_models/motor'

export interface MotorSlice {
    gear: Gears
    driveMode: DriveModes
    rawThrottle: number
    throttle: number
    showRawThrottle: boolean
    pipeThroughRawThrottle: boolean
    rpm: number
    rpmBoundaries: [number, number]
    wheelCircumference: number
    speed: number
    dailyDistance: number
    speedLimit: number
    maxSettableSpeed: number
    minSettableSpeed: number
    pedalMultiplier: number
    flowState: FlowState
    debugFlowStateOverride: FlowState | null
    leftMotorData: KellyTelemetry | null
    rightMotorData: KellyTelemetry | null
    setGear: (gear: Gears) => void
    setDriveMode: (driveMode: DriveModes) => void
    setRawThrottle: (rawThrottle: number) => void
    setThrottle: (throttle: number) => void
    setShowRawThrottle: (showRawThrottle: boolean) => void
    setPipeThroughRawThrottle: (pipeThroughRawThrottle: boolean) => void
    setRpm: (rpm: number) => void
    setWheelCircumference: (wheelCircumference: number) => void
    setSpeed: (speed: number) => void
    setDailyDistance: (dailyDistance: number) => void
    setSpeedLimit: (speedLimit: number) => void
    setMaxSettableSpeed: (maxSettableSpeed: number) => void
    setMinSettableSpeed: (minSettableSpeed: number) => void
    setPedalMultiplier: (pedalMultiplier: number) => void
    setDebugFlowStateOverride: (flowState: FlowState | null) => void
    setLeftMotorData: (data: KellyTelemetry) => void
    setRightMotorData: (data: KellyTelemetry) => void
    relay1On: boolean
    relay2On: boolean
    relay1Pending: boolean
    relay2Pending: boolean
    setRelay1On: (value: boolean) => void
    setRelay2On: (value: boolean) => void
    setRelay1Pending: (value: boolean) => void
    setRelay2Pending: (value: boolean) => void
  }

export const createMotorSlice: StateCreator<
  MotorSlice & BatterySlice,
  [],
  [],
  MotorSlice
  > = (set, get) => ({
  gear: Gears.d,
  driveMode: DriveModes.ludicrous,
  rawThrottle: 0.45,
  throttle: 0.75,
  showRawThrottle: true,
  pipeThroughRawThrottle: false,
  rpm: 1250,
  rpmBoundaries: [0, 1500],
  wheelCircumference: 1.415,
  speed: 0,
  dailyDistance: 1234.5,
  speedLimit: 35,
  maxSettableSpeed: 35,
  minSettableSpeed: 7,
  pedalMultiplier: 100,
  flowState: FlowState.IDLE,
  debugFlowStateOverride: null,
  leftMotorData: null,
  rightMotorData: null,
  setGear: (gear: Gears) => set({ gear }),
  setDriveMode: (driveMode: DriveModes) => set({ driveMode }),
  setRawThrottle: (rawThrottle: number) => set({ rawThrottle }),
  setThrottle: (throttle: number) => {
    const batteryCurrent = get().batteryCurrent;
    const rpm = get().rpm;
    const debugOverride = get().debugFlowStateOverride;
    set({ 
      throttle: throttle,
      flowState: debugOverride ?? calculateFlowState(batteryCurrent, throttle, rpm)
    });
  },
  setShowRawThrottle: (showRawThrottle: boolean) => set({ showRawThrottle }),
  setPipeThroughRawThrottle: (pipeThroughRawThrottle: boolean) => set({ pipeThroughRawThrottle }),
  setRpm: (rpm: number) => {
    const wheelCircumference = get().wheelCircumference;
    const batteryCurrent = get().batteryCurrent;
    const throttle = get().throttle;
    const debugOverride = get().debugFlowStateOverride;
    set({ 
      rpm: rpm,
      speed: (rpm / 60) * wheelCircumference * 3.6,
      flowState: debugOverride ?? calculateFlowState(batteryCurrent, throttle, rpm)
    });
  },
  setWheelCircumference: (wheelCircumference: number) => set({ wheelCircumference }),
  setSpeed: (speed: number) => set({ speed }),
  setDailyDistance: (dailyDistance: number) => set({ dailyDistance }),
  setSpeedLimit: (speedLimit: number) => set({ speedLimit }),
  setMaxSettableSpeed: (maxSettableSpeed: number) => set({ maxSettableSpeed }),
  setMinSettableSpeed: (minSettableSpeed: number) => set({ minSettableSpeed }),
  setPedalMultiplier: (pedalMultiplier: number) => set({ pedalMultiplier }),
  setDebugFlowStateOverride: (flowState: FlowState | null) => {
    const batteryCurrent = get().batteryCurrent;
    const throttle = get().throttle;
    const rpm = get().rpm;
    set({ 
      debugFlowStateOverride: flowState,
      flowState: flowState ?? calculateFlowState(batteryCurrent, throttle, rpm)
    });
  },
  setLeftMotorData: (data: KellyTelemetry) => set({ leftMotorData: data }),
  setRightMotorData: (data: KellyTelemetry) => set({ rightMotorData: data }),
  relay1On: false,
  relay2On: false,
  relay1Pending: false,
  relay2Pending: false,
  setRelay1On: (value: boolean) => set({ relay1On: value }),
  setRelay2On: (value: boolean) => set({ relay2On: value }),
  setRelay1Pending: (value: boolean) => set({ relay1Pending: value }),
  setRelay2Pending: (value: boolean) => set({ relay2Pending: value }),
  })