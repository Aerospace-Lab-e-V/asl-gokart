import { Moon } from "lucide-react";
import React from "react";
import { Button } from "@/components/ui/button";
import { toggleTheme } from "@/services/theme";

export function ToggleTheme() {
    return (
        <Button onClick={toggleTheme} size="icon">
            <Moon size={16} />
        </Button>
    );
}
