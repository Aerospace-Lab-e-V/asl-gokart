export enum Zones {
    BATTERY = "battery",
    MOTOR = "motor",
    LIGHTS = "lights",
}

export enum BatteryCommands {
    GET_VOLTAGE = "getVoltage",
    GET_CURRENT = "getCurrent",
    GET_TEMP = "getTemp",
    GET_CHARGE = "getCharge",
    GET_DISCHARGE = "getDischarge",
    GET_POWER = "getPower",
    GET_ENERGY = "getEnergy",
    GET_STATUS = "getStatus",
    GET_HEALTH = "getHealth",
}

export enum MotorCommands {
    GET_RPM = "getRpm",
    GET_LEFT_MOTOR_DATA = "getLeftMotorData",
    GET_RIGHT_MOTOR_DATA = "getRightMotorData",
    TOGGLE_RELAY = "toggleRelay",
    GET_RELAY_STATES = "getRelayStates",
    GET_REVERSE = "getReverse",
}

export enum LightsCommands {
    GET_TURN_SIGNAL_LIGHTS = "getTurnSignalLights",
    SET_TURN_SIGNAL_LIGHTS = "setTurnSignalLights",
    SET_TOGGLE_TURN_SIGNAL_LEFT = "setToggleTurnSignalLeft",
    SET_TOGGLE_TURN_SIGNAL_RIGHT = "setToggleTurnSignalRight",
    SET_TOGGLE_HAZARD_LIGHTS = "setToggleHazardLights",
    GET_HEADLIGHTS = "getHeadlights",
    SET_TOGGLE_HEADLIGHTS = "setToggleHeadlights",
    GET_HIGH_BEAMS = "getHighBeams",
    SET_TOGGLE_HIGH_BEAMS = "setToggleHighBeams",
    TRIGGER_WELCOME_LIGHT = "triggerWelcomeLight",
    SET_WELCOME_LIGHT_COLOR = "setWelcomeLightColor",
    SET_BRIGHTNESS = "setBrightness",
    SET_TOGGLE_BRAKE = "setToggleBrake",
    SET_TOGGLE_REVERSE = "setToggleReverse",
    SET_TOGGLE_DRL = "setToggleDrl",
    GET_TAIL_LIGHTS = "getTailLights",
    SET_TOGGLE_TAIL_LIGHT = "setToggleTailLight",
}
