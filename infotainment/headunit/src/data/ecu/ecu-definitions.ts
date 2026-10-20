import { EcuDefinition } from './ecu-types';

export const ECU_DEFINITIONS: EcuDefinition[] = [
    {
        id: 'zc_buttons',
        displayName: 'Button Controller',
        githubAssetName: 'firmware_zc_buttons.bin',
        seroServiceId: 0x0002,
    },
    {
        id: 'zc_lights',
        displayName: 'Lights Controller',
        githubAssetName: 'firmware_zc_lights.bin',
        seroServiceId: 0x0001,
    },
    {
        id: 'zc_battery',
        displayName: 'Battery Controller',
        githubAssetName: 'firmware_zc_battery.bin',
        seroServiceId: 0x0003,
    },
    {
        id: 'zc_motor',
        displayName: 'Motor Controller',
        githubAssetName: 'firmware_zc_motor.bin',
        seroServiceId: 0x0004,
    },
];
