import { HeaderBar } from "@/components/shared/header-bar";
import { useStore } from "@/stores/useStore";
import { useShallow } from "zustand/react/shallow";
import React from "react";
import { ColorPicker } from "@/components/color-picker";
import { CirclePicker } from "react-color";
import { PRESET_COLORS } from "@/data/lighting/color-definitions";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { LightsCommands } from "@/data/zonecontrollers/zonecontrollers";
import { hexToRgb } from "@/lib/utils";



import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

const presetColors = PRESET_COLORS.map(color => color.hex);

const CarPage = () => {
    const { 
        underglowColor, 
        setUnderglowColor, 
        welcomeLightColor, 
        setWelcomeLightColor,
        underglowBrigthness,
        setUnderglowBrightness,
        welcomeLightBrightness,
        setWelcomeLightBrightness,
        underglowOn,
        setUnderglowOn,
        welcomeLightOn,
        setWelcomeLightOn
    } = useStore(useShallow((state) => ({
        underglowColor: state.underglowColor,
        setUnderglowColor: state.setUnderglowColor,
        welcomeLightColor: state.welcomeLightColor,
        setWelcomeLightColor: state.setWelcomeLightColor,
        underglowBrigthness: state.underglowBrigthness,
        welcomeLightBrightness: state.welcomeLightBrightness,
        setUnderglowBrightness: state.setUnderglowBrightness,
        setWelcomeLightBrightness: state.setWelcomeLightBrightness,
        underglowOn: state.underglowOn,
        setUnderglowOn: state.setUnderglowOn,
        welcomeLightOn: state.welcomeLightOn,
        setWelcomeLightOn: state.setWelcomeLightOn,
    })));

    React.useEffect(() => {
        const rgb = hexToRgb(welcomeLightColor);
        window.sero.sendLightsCommand(LightsCommands.SET_WELCOME_LIGHT_COLOR, rgb);
    }, [welcomeLightColor]);

    React.useEffect(() => {
        window.sero.sendLightsCommand(LightsCommands.SET_BRIGHTNESS, [0xFF, welcomeLightBrightness]);
    }, [welcomeLightBrightness]);

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-background">
            <HeaderBar />
            <div className="flex-1 flex flex-col items-center justify-start p-8 overflow-hidden">
                <div className="flex flex-col items-center justify-center gap-2 w-full max-w-5xl">
                    <div className="flex flex-col md:flex-row w-full gap-8">
                    
                    {/* Underglow Control Card */}
                    <Card className="w-1/2">
                        <CardHeader>
                            <CardTitle>
                                <div className="flex items-center justify-between">
                                    Underglow
                                    {/*
                                        TODO: Replace with Sero call to zc_lights to toggle welcome light 
                                        TODO: Value is only updated when the Sero call returns with E_OK.
                                    */}
                                    <Switch 
                                        className="ml-4" 
                                        checked={underglowOn}
                                        onCheckedChange={setUnderglowOn}
                                    />
                                </div>
                            </CardTitle>
                            <CardDescription>Illuminate the tarmac!</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col gap-4">
                                    {/*
                                        TODO: Replace with Sero call to zc_lights to toggle welcome light 
                                        TODO: Value is only updated when the Sero call returns with E_OK.
                                    */}
                                <Slider 
                                    defaultValue={[underglowBrigthness]}
                                    min={0}
                                    max={100}
                                    step={1}
                                    onValueChange={(value) => setUnderglowBrightness(value[0])}
                                />
                                <ColorPicker 
                                    color={underglowColor} 
                                    onChange={(color: any) => setUnderglowColor(color.hex)}
                                />
                                <CirclePicker 
                                    color={underglowColor} 
                                    onChange={(color: any) => setUnderglowColor(color.hex)} 
                                    circleSize={28} 
                                    circleSpacing={14} 
                                    colors={presetColors}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Welcome Light Control Card */}
                    <Card className="w-1/2">
                        <CardHeader>
                            <CardTitle>
                                <div className="flex items-center justify-between">
                                    Welcome Light
                                    {/*
                                        TODO: Replace with Sero call to zc_lights to toggle welcome light 
                                        TODO: Value is only updated when the Sero call returns with E_OK.
                                    */}
                                    <Switch 
                                        className="ml-4" 
                                        checked={welcomeLightOn}
                                        onCheckedChange={setWelcomeLightOn}
                                        disabled={true}
                                    />
                                </div>
                            </CardTitle>
                            <CardDescription>Front eyebrows glow color on startup</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col gap-4">
                                {/*
                                    TODO: Replace with Sero call to zc_lights to toggle welcome light 
                                    TODO: Value is only updated when the Sero call returns with E_OK.
                                */}
                                <Slider 
                                    defaultValue={[welcomeLightBrightness]}
                                    min={0}
                                    max={100}
                                    step={1}
                                    onValueChange={(value) => setWelcomeLightBrightness(value[0])}
                                />
                                <ColorPicker 
                                    color={welcomeLightColor} 
                                    onChange={(color: any) => setWelcomeLightColor(color.hex)}
                                />
                                <CirclePicker 
                                    color={welcomeLightColor} 
                                    onChange={(color: any) => setWelcomeLightColor(color.hex)}
                                    circleSize={28} 
                                    circleSpacing={14} 
                                    colors={presetColors}
                                />
                            </div>
                        </CardContent>
                    </Card>
                    </div>

                    {/* Lights Tester Panel */}
                    <Card className="w-full">
                        <CardHeader>
                            <CardTitle>Lights Tester</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-4">
                                <Button onClick={() => window.sero.sendLightsCommand(LightsCommands.TRIGGER_WELCOME_LIGHT)}>Trigger Welcome</Button>
                                <Button onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_TURN_SIGNAL_LEFT)}>Toggle Left Turn</Button>
                                <Button onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_TURN_SIGNAL_RIGHT)}>Toggle Right Turn</Button>
                                <Button onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_HAZARD_LIGHTS)}>Toggle Hazards</Button>
                                <Button onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_HIGH_BEAMS)}>Toggle High Beams</Button>
                                <Button onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_BRAKE)}>Toggle Brake</Button>
                                <Button onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_REVERSE)}>Toggle Reverse</Button>
                                <Button onClick={() => window.sero.sendLightsCommand(LightsCommands.SET_TOGGLE_DRL)}>Toggle DRL</Button>
                            </div>
                        </CardContent>
                    </Card>

                </div>
            </div>
        </div>
    );
}

export default CarPage;