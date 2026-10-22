import { render, screen } from "@testing-library/react";
import React from "react";
import { LiquidBattery } from "@/components/battery/liquid-battery";
import { FlowState } from "@/domain/signals";

test("no data is an empty battery with dashes", () => {
    render(<LiquidBattery soc={null} flow={null} level={1} />);

    expect(screen.getByTestId("liquid")).toHaveStyle({ height: "0%" });
    // The number and the label; the clipped copy of the number is hidden from screen readers.
    expect(screen.getAllByText("--")).toHaveLength(3);
    expect(screen.queryByTestId("bubble")).toBeNull();
});

test("the liquid is green, amber at 25 % and red at 10 %", () => {
    const tone = (soc: number) => {
        const { unmount } = render(<LiquidBattery soc={soc} flow={FlowState.IDLE} level={1} />);
        const classes = [...screen.getByTestId("liquid").classList];
        unmount();
        return classes.find((c) => /^bg-(green|amber|red)-500$/.test(c));
    };

    expect(tone(26)).toBe("bg-green-500");
    expect(tone(25)).toBe("bg-amber-500");
    expect(tone(11)).toBe("bg-amber-500");
    expect(tone(10)).toBe("bg-red-500");
});

test("charging shows more bubbles as the current grows, and no bands", () => {
    const { rerender } = render(<LiquidBattery soc={60} flow={FlowState.REGEN} level={1} />);
    expect(screen.getAllByTestId("bubble")).toHaveLength(4);
    expect(screen.queryByTestId("band")).toBeNull();
    expect(screen.getByText("Charging")).toBeInTheDocument();

    rerender(<LiquidBattery soc={60} flow={FlowState.REGEN} level={3} />);
    expect(screen.getAllByTestId("bubble")).toHaveLength(10);
});

test("discharging shows sinking bands, idle shows nothing moving", () => {
    const { rerender } = render(<LiquidBattery soc={60} flow={FlowState.POWER} level={2} />);
    expect(screen.getAllByTestId("band")).toHaveLength(2);
    expect(screen.queryByTestId("bubble")).toBeNull();
    expect(screen.getByText("Discharging")).toBeInTheDocument();

    rerender(<LiquidBattery soc={60} flow={FlowState.IDLE} level={2} />);
    expect(screen.queryByTestId("band")).toBeNull();
    expect(screen.queryByTestId("bubble")).toBeNull();
    expect(screen.getByText("Idle")).toBeInTheDocument();
});
