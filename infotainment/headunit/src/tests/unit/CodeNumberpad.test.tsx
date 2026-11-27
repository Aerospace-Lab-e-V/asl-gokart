import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { CodeNumberpad } from "@/components/admin-mode/code-numberpad";

// jsdom has no PointerEvent; without it fireEvent.pointerDown drops `button`.
beforeAll(() => {
    if (!("PointerEvent" in window)) {
        Object.defineProperty(window, "PointerEvent", { value: class extends MouseEvent {}, configurable: true });
    }
});

const Harness = () => {
    const [pin, setPin] = useState("");
    return (
        <>
            <output data-testid="pin">{pin}</output>
            <CodeNumberpad value={pin} onChange={setPin} />
        </>
    );
};

const pin = () => screen.getByTestId("pin").textContent;
const key = (name: string) => screen.getByRole("button", { name });
// A finger: pointerdown, pointerup, then the click Chromium may or may not synthesize.
const tap = (el: HTMLElement) => {
    fireEvent.pointerDown(el, { button: 0 });
    fireEvent.pointerUp(el);
    fireEvent.click(el, { detail: 1 });
};

describe("CodeNumberpad", () => {
    it("types on finger-down, without waiting for the click", () => {
        render(<Harness />);
        fireEvent.pointerDown(key("1"), { button: 0 });
        expect(pin()).toBe("1");
    });

    it("counts a full tap once, also for repeated taps on one key", () => {
        render(<Harness />);
        tap(key("7"));
        tap(key("7"));
        expect(pin()).toBe("77");
    });

    it("still types from the keyboard (click with detail 0)", () => {
        render(<Harness />);
        fireEvent.click(key("4"), { detail: 0 });
        expect(pin()).toBe("4");
    });

    it("stops at 5 digits, deletes and clears", () => {
        render(<Harness />);
        ["1", "2", "3", "4", "5", "6"].forEach((d) => tap(key(d)));
        expect(pin()).toBe("12345");
        expect(key("6")).toBeDisabled();

        tap(key("Delete last digit"));
        expect(pin()).toBe("1234");

        tap(key("Clear"));
        expect(pin()).toBe("");
        expect(key("Clear")).toBeDisabled();
    });

    it("ignores secondary mouse buttons", () => {
        render(<Harness />);
        fireEvent.pointerDown(key("1"), { button: 2 });
        expect(pin()).toBe("");
    });
});
