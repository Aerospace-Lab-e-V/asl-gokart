import React, { useEffect, useState } from "react";
import { HeaderBar } from "@/components/shared/header-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCw, Sliders, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AdcStatusData, TinybufStatus } from "@/data/tinybuf/tinybuf-types";

const TinybufPage = () => {
    const navigate = useNavigate();

    const [ledOn, setLedOn] = useState(false);
    const [isSendingLed, setIsSendingLed] = useState(false);
    const [adcData, setAdcData] = useState<AdcStatusData | null>(null);
    const [lastAdcTimestamp, setLastAdcTimestamp] = useState<Date | null>(null);
    const [serviceStatus, setServiceStatus] = useState<TinybufStatus | null>(null);
    const [isLoadingStatus, setIsLoadingStatus] = useState(false);

    // Fetch initial status
    const fetchStatus = async () => {
        if (!window.tinybuf?.getStatus) return;
        setIsLoadingStatus(true);
        try {
            const status = await window.tinybuf.getStatus();
            setServiceStatus(status);
        } catch (err) {
            console.error("Failed to get tinybuf status:", err);
        } finally {
            setIsLoadingStatus(false);
        }
    };

    useEffect(() => {
        fetchStatus();

        // Subscribe to ADC status updates via IPC
        if (window.tinybuf?.onAdcStatus) {
            const cleanup = window.tinybuf.onAdcStatus((data: AdcStatusData) => {
                setAdcData(data);
                setLastAdcTimestamp(new Date());
            });
            return cleanup;
        }
    }, []);

    // Toggle LED command
    const handleToggleLed = async () => {
        if (!window.tinybuf?.sendLedCommand) {
            toast.error("Tinybuf IPC not available");
            return;
        }

        const nextState = !ledOn;
        setIsSendingLed(true);
        try {
            const success = await window.tinybuf.sendLedCommand(nextState);
            if (success) {
                setLedOn(nextState);
                toast.success(`LED turned ${nextState ? "ON" : "OFF"}`);
            } else {
                toast.error("Failed to send LED command (proxy not active)");
            }
        } catch (err) {
            toast.error(`Error toggling LED: ${err}`);
        } finally {
            setIsSendingLed(false);
        }
    };

    // Calculate percentage for ADC progress bar
    const adcPercentage =
        adcData && adcData.max > adcData.min
            ? Math.min(
                  100,
                  Math.max(0, ((adcData.value - adcData.min) / (adcData.max - adcData.min)) * 100)
              )
            : 0;

    return (
        <div className="flex h-full w-full flex-col">
            <HeaderBar />

            {/* Sub-header navigation */}
            <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                    <div>Tinybuf Proxy Connection Status:</div>
                    <Badge
                        variant={serviceStatus?.available ? "default" : "secondary"}
                        className="text-xs"
                    >
                        {serviceStatus?.available ? "Connected" : "Standby / Offline"}
                    </Badge>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={fetchStatus}
                        disabled={isLoadingStatus}
                        className="h-8 w-8"
                    >
                        <RefreshCw className={`h-4 w-4 ${isLoadingStatus ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </div>

            <Separator />

            {/* Content Body */}
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {/* LED Control Card */}
                    <Card className="flex flex-col justify-between">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    LED Control
                                </CardTitle>
                            </div>
                            <CardDescription>
                                Dispatch LedCommand message via Tinybuf proxy
                            </CardDescription>
                        </CardHeader>

                        <CardContent className="space-y-6">
                            <div className="bg-muted/40 flex items-center justify-between rounded-lg border p-4">
                                <div className="space-y-1">
                                    <Label htmlFor="led-switch" className="text-sm font-medium">
                                        Toggle LED State
                                    </Label>
                                    <p className="text-muted-foreground text-xs">
                                        Click button or flip switch to transmit command
                                    </p>
                                </div>
                                <Switch
                                    id="led-switch"
                                    checked={ledOn}
                                    onCheckedChange={handleToggleLed}
                                    disabled={isSendingLed}
                                />
                            </div>

                            <Button
                                className="h-12 w-full text-base font-semibold"
                                variant={ledOn ? "destructive" : "default"}
                                onClick={handleToggleLed}
                                disabled={isSendingLed}
                            >
                                <Zap className="mr-2 h-4 w-4" />
                                {ledOn ? "Turn LED OFF" : "Turn LED ON"}
                            </Button>
                        </CardContent>
                    </Card>

                    {/* ADC Status Card */}
                    <Card className="flex flex-col justify-between">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    ADC Status
                                </CardTitle>
                                <Badge variant={adcData ? "secondary" : "outline"}>
                                    {adcData ? "Receiving Data" : "Awaiting Data"}
                                </Badge>
                            </div>
                            <CardDescription>
                                Real-time AdcStatus telemetry from Tinybuf proxy
                            </CardDescription>
                        </CardHeader>

                        <CardContent className="space-y-4">
                            <div className="bg-muted/40 space-y-3 rounded-lg border p-4">
                                <div className="flex items-baseline justify-between">
                                    <span className="text-muted-foreground text-sm font-medium">
                                        Current Value
                                    </span>
                                    <span className="font-mono text-3xl font-bold tracking-tight">
                                        {adcData !== null ? adcData.value : "—"}
                                    </span>
                                </div>

                                <Progress value={adcPercentage} className="h-2" />

                                <div className="text-muted-foreground flex justify-between pt-1 font-mono text-xs">
                                    <span>Min: {adcData !== null ? adcData.min : "—"}</span>
                                    <span>{adcPercentage.toFixed(1)}%</span>
                                    <span>Max: {adcData !== null ? adcData.max : "—"}</span>
                                </div>
                            </div>

                            <div className="text-muted-foreground flex items-center justify-between px-1 text-xs">
                                <span>Last updated:</span>
                                <span className="font-mono">
                                    {lastAdcTimestamp
                                        ? lastAdcTimestamp.toLocaleTimeString()
                                        : "None"}
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Diagnostics Card */}
                <Card>
                    <CardHeader className="py-3">
                        <CardTitle className="flex items-center gap-2 text-sm font-medium">
                            <Sliders className="h-4 w-4" />
                            Diagnostics
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0 text-xs">
                        <div className="grid grid-cols-3 gap-2 py-1">
                            <div>
                                <span className="text-muted-foreground">Proxy Status: </span>
                                <span className="font-semibold">
                                    {serviceStatus?.status || "Unknown"}
                                </span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Run Level: </span>
                                <span className="font-semibold">
                                    {serviceStatus?.runLevel ?? "—"}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default TinybufPage;
