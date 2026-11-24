import { expect, test } from "@playwright/test";

const customSongs = [
    {
        id: "lastfm:Fixture:Start%20Song",
        title: "An exceptionally long starting song title that should wrap on mobile",
        artist: "A very long artist name for a narrow screen",
        albumArt: "",
    },
    {
        id: "lastfm:Fixture:Destination%20Song",
        title: "Destination Song",
        artist: "Fixture Artist",
        albumArt: "",
    },
];

test.describe("game accessibility and responsive layout", () => {
    test("keeps the random game within narrow viewports and supports keyboard play", async ({
        page,
    }) => {
        await page.goto("/game");
        await expect(
            page.getByRole("heading", { name: "Link the songs" }),
        ).toBeVisible();
        const radioFoundation = await page.locator("main[data-theme='radio-terminal']").evaluate(
            (element) => {
                const mainStyle = getComputedStyle(element);
                const panelStyle = getComputedStyle(
                    element.querySelector(".radio-terminal-panel")!,
                );
                const buttonStyle = getComputedStyle(
                    element.querySelector(".radio-mechanical-button")!,
                );
                return {
                    background: mainStyle.backgroundColor,
                    panelBorder: panelStyle.borderTopColor,
                    buttonHeight: Number.parseFloat(buttonStyle.minHeight),
                    technicalFont: getComputedStyle(
                        element.querySelector(".radio-technical-label")!,
                    ).fontFamily,
                    cream: mainStyle.getPropertyValue("--radio-cream").trim(),
                    display: mainStyle.getPropertyValue("--radio-display").trim(),
                };
            },
        );
        expect(radioFoundation.background).toBe("rgb(34, 43, 38)");
        expect(radioFoundation.panelBorder).not.toBe("rgba(0, 0, 0, 0)");
        expect(radioFoundation.buttonHeight).toBeGreaterThanOrEqual(44);
        expect(radioFoundation.technicalFont).toContain("monospace");
        expect(radioFoundation.cream).toBe("#e9dfc5");
        expect(radioFoundation.display).toBe("#a5c7ac");

        const receiver = page.getByRole("region", { name: "Song receiver" });
        const navigation = page.getByRole("complementary", {
            name: "Navigation panel",
        });
        await expect(receiver).toBeVisible();
        await expect(navigation.getByRole("region", { name: /Destination:/ })).toBeVisible();
        await expect(
            receiver.getByRole("list", { name: "Legal song recommendations" }),
        ).toBeVisible();

        const raceMode = page.getByRole("combobox", { name: "Race mode" });
        const songSource = page.getByRole("combobox", { name: "Song source" });
        await page.keyboard.press("Tab");
        await expect(raceMode).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(songSource).toBeFocused();

        for (const width of [320, 375, 390, 640, 768, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            const layout = await page.evaluate(() => {
                const receiverRect = document
                    .querySelector('[aria-label="Song receiver"]')!
                    .getBoundingClientRect();
                const navigationRect = document
                    .querySelector('[aria-label="Navigation panel"]')!
                    .getBoundingClientRect();
                return {
                    scrollWidth: document.documentElement.scrollWidth,
                    receiverLeft: receiverRect.left,
                    receiverBottom: receiverRect.bottom,
                    navigationLeft: navigationRect.left,
                    navigationTop: navigationRect.top,
                };
            });
            expect(
                layout.scrollWidth,
                `horizontal overflow at ${width}px`,
            ).toBeLessThanOrEqual(width);
            if (width < 768) {
                expect(layout.navigationTop).toBeGreaterThanOrEqual(
                    layout.receiverBottom - 1,
                );
            } else {
                expect(layout.navigationLeft).toBeGreaterThan(
                    layout.receiverLeft,
                );
                expect(layout.navigationTop).toBeLessThan(
                    layout.receiverBottom,
                );
            }
        }

        await page.setViewportSize({ width: 320, height: 900 });
        const backButton = page.getByRole("button", {
            name: "Back to previous song",
        });
        const backHeight = await backButton.evaluate(
            (element) => element.getBoundingClientRect().height,
        );
        expect(backHeight).toBeGreaterThanOrEqual(44);

        const currentSong = page.locator('[aria-label^="Current song:"]');
        const previousSong = await currentSong.getAttribute("aria-label");
        const move = page
            .getByRole("list", { name: "Legal song recommendations" })
            .getByRole("button")
            .first();
        await move.focus();
        await page.keyboard.press("Enter");
        await expect(currentSong).not.toHaveAttribute("aria-label", previousSong);
        await expect(
            page.getByRole("heading", { name: "Current song" }),
        ).toBeFocused();
        await expect(page.locator(".sr-only[aria-live='polite']")).toContainText(
            "Current song:",
        );
    });

    test("labels custom search, announces loading and errors, and restores focus for retry and race start", async ({
        page,
    }) => {
        let failedSearchOnce = false;
        await page.route("**/api/music/search**", async (route) => {
            const query = new URL(route.request().url()).searchParams.get("query");
            if (query === "empty") {
                await route.fulfill({ json: { songs: [] } });
                return;
            }
            if (query === "error" && !failedSearchOnce) {
                failedSearchOnce = true;
                await route.fulfill({
                    status: 502,
                    json: { error: "upstream detail must not be shown" },
                });
                return;
            }
            await route.fulfill({ json: { songs: customSongs } });
        });
        let recommendationRequests = 0;
        await page.route("**/api/music/similar**", async (route) => {
            recommendationRequests += 1;
            if (recommendationRequests === 1) {
                await new Promise((resolve) => setTimeout(resolve, 150));
                await route.fulfill({
                    status: 502,
                    json: { error: "upstream detail must not be shown" },
                });
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
            await route.fulfill({ json: { songs: [customSongs[1]] } });
        });

        await page.setViewportSize({ width: 320, height: 900 });
        await page.goto("/game");
        await page.getByRole("combobox", { name: "Race mode" }).selectOption("custom");
        await expect(
            page.getByRole("combobox", { name: "Race mode" }),
        ).toBeFocused();

        const startSearch = page.getByRole("searchbox", {
            name: "Starting song search",
        });
        const destinationSearch = page.getByRole("searchbox", {
            name: "Destination song search",
        });
        await expect(startSearch).toBeVisible();
        await expect(destinationSearch).toBeVisible();
        const startPanel = page.getByRole("region", {
            name: "Starting song selection",
        });
        const destinationPanel = page.getByRole("region", {
            name: "Destination song selection",
        });
        for (const width of [320, 390, 768, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            await expect(startPanel).toBeVisible();
            await expect(destinationPanel).toBeVisible();
            const layout = await page.evaluate(() => {
                const start = document
                    .querySelector('[aria-label="Starting song selection"]')!
                    .getBoundingClientRect();
                const destination = document
                    .querySelector('[aria-label="Destination song selection"]')!
                    .getBoundingClientRect();
                return {
                    scrollWidth: document.documentElement.scrollWidth,
                    startBottom: start.bottom,
                    destinationLeft: destination.left,
                    destinationTop: destination.top,
                    startLeft: start.left,
                };
            });
            expect(layout.scrollWidth).toBeLessThanOrEqual(width);
            if (width < 768) {
                expect(layout.destinationTop).toBeGreaterThanOrEqual(
                    layout.startBottom - 1,
                );
            } else {
                expect(layout.destinationLeft).toBeGreaterThan(layout.startLeft);
            }
        }
        await page.setViewportSize({ width: 320, height: 900 });

        await startSearch.fill("empty");
        await expect(page.getByRole("status")).toContainText(
            "Searching Last.fm",
        );
        await expect(page.getByRole("status")).toContainText(
            "No songs found",
        );

        await startSearch.fill("error");
        const searchError = page.getByRole("alert");
        await expect(searchError).toContainText(
            "Song search is temporarily unavailable",
        );
        await expect(searchError).not.toContainText("upstream detail");
        await searchError.getByRole("button", { name: "Retry search" }).click();
        await expect(startSearch).toBeFocused();

        const startResults = page.getByRole("list", {
            name: "Starting song search results",
        });
        await startResults.waitFor({ state: "visible" });
        const startingSongResult = startResults.getByRole("button").first();
        await startingSongResult.focus();
        await page.keyboard.press("Enter");
        await expect(
            startPanel.locator(".radio-selected-song").getByText(customSongs[0].title),
        ).toBeVisible();
        await expect(
            startPanel.locator(".radio-selected-song").getByText(customSongs[0].artist),
        ).toBeVisible();

        await destinationSearch.fill("destination");
        const destinationResults = page.getByRole("list", {
            name: "Destination song search results",
        });
        const destinationSongResult = destinationResults.getByRole("button").nth(1);
        await destinationSongResult.focus();
        await page.keyboard.press("Space");
        await expect(
            destinationPanel.locator(".radio-selected-song").getByText(customSongs[1].title),
        ).toBeVisible();
        await expect(
            destinationPanel.locator(".radio-selected-song").getByText(customSongs[1].artist),
        ).toBeVisible();
        await expect(page.locator(".radio-readiness-indicator")).toContainText(
            "Route endpoints ready",
        );

        const startRace = page.getByRole("button", { name: "Start Race" });
        const primaryActionColors = await startRace.evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, color: style.color };
        });
        expect(primaryActionColors).toEqual({
            background: "rgb(165, 199, 172)",
            color: "rgb(24, 27, 25)",
        });
        await startRace.focus();
        await page.keyboard.press("Enter");

        const currentSongHeading = page.getByRole("heading", {
            name: "Current song",
        });
        await expect(currentSongHeading).toBeFocused();
        await expect(page.getByRole("status")).toContainText(
            "Loading recommendations for this song",
        );
        await page.emulateMedia({ reducedMotion: "reduce" });
        const spinnerDuration = await page
            .getByRole("status")
            .locator("svg")
            .evaluate((element) => getComputedStyle(element).animationDuration);
        expect(Number.parseFloat(spinnerDuration)).toBeLessThan(0.1);
        const retry = page.getByRole("button", {
            name: "Retry recommendations",
        });
        await expect(retry).toBeVisible();
        await expect(page.getByRole("alert")).not.toContainText(
            "upstream detail",
        );

        await retry.click();
        await expect(currentSongHeading).toBeFocused();
        const destinationMove = page.getByRole("button", {
            name: "Move to Destination Song by Fixture Artist",
        });
        await destinationMove.waitFor({ state: "visible" });
        await destinationMove.focus();
        await page.keyboard.press("Space");
        await expect(page.getByRole("heading", { name: "Signal Acquired" })).toBeVisible();
        await expect(page.getByRole("status")).toContainText(
            "Destination reached: Destination Song by Fixture Artist.",
        );
        await expect(page.getByRole("region", { name: "Signal Acquired" })).toContainText(
            "Unavailable for custom races",
        );
        await expect(
            page.getByRole("region", { name: "Signal Acquired" })
                .getByRole("list", { name: "Completed route in order" })
                .locator("li"),
        ).toHaveCount(2);
        expect(recommendationRequests).toBe(2);

        const scrollWidth = await page.evaluate(
            () => document.documentElement.scrollWidth,
        );
        expect(scrollWidth).toBeLessThanOrEqual(320);
    });
});
