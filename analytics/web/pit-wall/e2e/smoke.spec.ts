import { expect, test, type Page } from "@playwright/test";

// Expects exactly one kart online (kart-sim publishes kart-01).

async function dataAgeMs(page: Page): Promise<number> {
    const text = await page.locator("dt:text-is('Data age') + dd").innerText();
    const m = /^(\d+) ms$/.exec(text.trim());
    return m ? Number(m[1]) : Infinity;
}

test("opens the online kart and shows live data", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/kart\/kart-01/);
    await expect(page.getByRole("heading", { name: "kart-01" })).toBeVisible();

    const speed = page.locator(".stat", {
        has: page.locator(".stat-title", { hasText: /^Speed$/ }),
    });
    await expect(speed.locator(".stat-value")).toHaveText(/^\d+/, { timeout: 10_000 });

    // ≤ 250 ms is the target, 500 ms the hard limit (README, latency target).
    await expect.poll(() => dataAgeMs(page), { timeout: 10_000 }).toBeLessThan(500);
    await expect(page.locator("canvas").first()).toBeVisible();
});

test("every view renders charts and keeps the window", async ({ page }) => {
    await page.goto("/kart/kart-01?window=1");
    for (const view of ["battery", "drivetrain", "thermal", ""]) {
        await page.goto(`/kart/kart-01/${view}?window=1`);
        await expect(page.locator("canvas").first()).toBeVisible();
        await expect(page.getByRole("link", { name: "1 min" })).toHaveAttribute(
            "aria-pressed",
            "true"
        );
    }
    await page.goto("/kart/kart-01/track");
    await expect(page.getByRole("heading", { name: "Track map" })).toBeVisible();
    await expect(page.locator(".leaflet-container")).toBeVisible();
    // kart-sim sends GPS, so the trail is drawn and the no-fix overlay is gone.
    await expect(page.getByText("No GPS data from this kart yet")).toBeHidden();
});
