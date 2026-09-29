import React from "react";
import { Loader2, WifiOff, SkipForward, Power } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NetworkGateScreen() {
    // ponytail: Tesla-style minimalist network waiting gate adapting to light & dark modes
    
    const handleSkip = () => {
        window.app.skipNetworkGate();
    };

    const handleQuit = () => {
        window.electronWindow.close();
    };

    return (
        <div className="flex flex-col items-center justify-center w-full h-full min-h-screen bg-background text-foreground p-6 selection:bg-accent">
            <div className="relative flex flex-col items-center space-y-8 max-w-md w-full text-center">
                {/* Subtle Tesla-style card panel */}
                <div className="relative w-full bg-card text-card-foreground border border-border/80 shadow-2xl rounded-3xl p-8 space-y-6">

                    <div className="relative flex items-center justify-center w-16 h-16 mx-auto rounded-2xl border border-border">
                        <WifiOff className="w-6 h-6 text-foreground/80 animate-pulse" />
                    </div>

                    <div className="space-y-3 relative">
                        <h1 className="text-xl font-semibold tracking-tight text-foreground">
                            Waiting for Vehicle Network
                        </h1>
                        <p className="text-muted-foreground leading-relaxed">
                            Establishing connection to the vehicle network. The infotainment system will start automatically once connected.
                        </p>
                    </div>

                    <div className="flex items-center justify-center space-x-2 text-sm text-blue-600 dark:text-blue-400 bg-blue-500/5 dark:bg-blue-400/5 border border-blue-500/10 dark:border-blue-400/10 px-3 py-1.5 rounded-full relative w-max mx-auto">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 dark:text-blue-400" />
                        <span>Searching for interface MAC...</span>
                    </div>

                    {/* Control Actions */}
                    <div className="flex items-center justify-center gap-3 w-full pt-2">
                        <Button 
                            onClick={handleSkip}
                            variant="outline"
                            className="flex-1 flex items-center justify-center gap-2 h-11 hover:bg-muted"
                        >
                            <SkipForward className="w-4 h-4" />
                            <span>Skip Check</span>
                        </Button>
                        <Button 
                            onClick={handleQuit}
                            variant="destructive"
                            className="flex-1 flex items-center justify-center gap-2 h-11"
                        >
                            <Power className="w-4 h-4" />
                            <span>Quit</span>
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
