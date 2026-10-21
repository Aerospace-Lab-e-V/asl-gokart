import { render } from "@testing-library/react";
import React from "react";
import * as Telltales from "@/components/icons/telltale";
import { BatteryFault, HighBeam } from "@/components/icons/telltale";

test("renders an svg sized and classed like lucide", () => {
    const { container } = render(<HighBeam size={36} className="text-blue-600" />);
    const svg = container.querySelector("svg")!;

    expect(svg).toHaveAttribute("width", "36");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg.classList).toContain("telltale-high-beam");
    expect(svg.classList).toContain("text-blue-600");
});

test("is hidden from screen readers unless titled", () => {
    const { container, getByRole } = render(
        <>
            <HighBeam />
            <HighBeam title="High beam on" />
        </>
    );

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(getByRole("img", { name: "High beam on" })).toBeInTheDocument();
});

test("gives each knockout mask its own id", () => {
    const { container } = render(
        <>
            <BatteryFault />
            <BatteryFault />
        </>
    );
    const ids = [...container.querySelectorAll("mask")].map((m) => m.id);

    expect(new Set(ids).size).toBe(2);
    container.querySelectorAll("svg").forEach((svg, i) => {
        expect(svg.querySelector("g[mask]")).toHaveAttribute("mask", `url(#${ids[i]})`);
    });
});

test("every exported icon renders", () => {
    const icons = Object.entries(Telltales).filter(
        (entry): entry is [string, Telltales.TelltaleIcon] => entry[0] !== "createTelltale"
    );

    expect(icons.length).toBeGreaterThan(30);
    for (const [name, Icon] of icons) {
        const { container, unmount } = render(<Icon />);
        expect(container.querySelector("svg")).toBeInTheDocument();
        expect(Icon.displayName).toBe(name);
        unmount();
    }
});
