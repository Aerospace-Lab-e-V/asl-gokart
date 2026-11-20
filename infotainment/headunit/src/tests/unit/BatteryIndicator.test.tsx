import { render, screen } from "@testing-library/react";
import React from "react";
import BatteryIndicator from "@/components/shared/battery-indicator";

const fill = (soc: number | null) => {
    const { unmount } = render(<BatteryIndicator batteryLevel={soc} />);
    const el = screen.getByTestId("soc-fill");
    const out = { width: el.style.width, tone: [...el.classList].find((c) => /^bg-(foreground|amber-500|red-500)$/.test(c)) };
    unmount();
    return out;
};

test("no data is an empty pill with dashes", () => {
    render(<BatteryIndicator batteryLevel={null} />);
    expect(screen.getByText("--%")).toBeInTheDocument();
    expect(screen.getByTestId("soc-fill")).toHaveStyle({ width: "0%" });
});

test("the pill fills to the SOC, amber at 25 % and red at 10 %", () => {
    expect(fill(60)).toEqual({ width: "60%", tone: "bg-foreground" });
    expect(fill(26).tone).toBe("bg-foreground");
    expect(fill(25).tone).toBe("bg-amber-500");
    expect(fill(10).tone).toBe("bg-red-500");
});
