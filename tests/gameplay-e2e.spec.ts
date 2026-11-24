import { expect, test, type Page, type Route } from "@playwright/test";
import { demoGraphRegistry } from "../src/game/demoGraphs";
import { findShortestPath } from "../src/game/pathfinding";

interface FixtureSong {
    id: string;
    title: string;
    artist: string;
    albumArt: string;
}

function song(name: string, albumArt = ""): FixtureSong {
    return {
        id: `lastfm:Fixture:${encodeURIComponent(name)}`,
        title: name,
        artist: "Fixture Artist",
        albumArt,
    };
}

function serializeGraph(
    songs: FixtureSong[],
    adjacency: Record<string, string[]>,
    expandedSongIds = songs.map(({ id }) => id),
) {
    return {
        songs,
        edges: songs.map(({ id }) => ({
            songId: id,
            recommendations: adjacency[id] ?? [],
        })),
        expandedSongIds,
    };
}

const randomFixtureSongs = [
    song("Race One Start"),
    song("Race One Left"),
    song("Race One Right"),
    song("Race One Middle"),
    song("Race One Near"),
    song("Race One Finish"),
    song("Race Two Start"),
    song("Race Two Left"),
    song("Race Two Right"),
    song("Race Two Middle"),
    song("Race Two Near"),
    song("Race Two Finish"),
];

const randomFixtureGraph = serializeGraph(randomFixtureSongs, {
    [randomFixtureSongs[0].id]: [
        randomFixtureSongs[1].id,
        randomFixtureSongs[2].id,
    ],
    [randomFixtureSongs[1].id]: [randomFixtureSongs[3].id],
    [randomFixtureSongs[2].id]: [randomFixtureSongs[3].id],
    [randomFixtureSongs[3].id]: [randomFixtureSongs[4].id],
    [randomFixtureSongs[4].id]: [randomFixtureSongs[5].id],
    [randomFixtureSongs[6].id]: [
        randomFixtureSongs[7].id,
        randomFixtureSongs[8].id,
    ],
    [randomFixtureSongs[7].id]: [randomFixtureSongs[9].id],
    [randomFixtureSongs[8].id]: [randomFixtureSongs[9].id],
    [randomFixtureSongs[9].id]: [randomFixtureSongs[10].id],
    [randomFixtureSongs[10].id]: [randomFixtureSongs[11].id],
});

async function installRandomGraph(page: Page) {
    let graphRequests = 0;
    await page.route("**/api/music/graph**", async (route) => {
        graphRequests += 1;
        await route.fulfill({ json: randomFixtureGraph });
    });
    return {
        get requestCount() {
            return graphRequests;
        },
    };
}

async function startCustomRace(
    page: Page,
    startSong: FixtureSong,
    targetSong: FixtureSong,
) {
    await page.getByRole("combobox", { name: "Race mode" }).selectOption("custom");
    await page.getByRole("combobox", { name: "Song source" }).selectOption("lastfm");
    await page.route("**/api/music/search**", async (route) => {
        const query = new URL(route.request().url()).searchParams.get("query") ?? "";
        const match = [startSong, targetSong].find(
            (item) => item.title.toLowerCase() === query.toLowerCase(),
        );
        await route.fulfill({ json: { songs: match ? [match] : [] } });
    });
    const startSearch = page.getByRole("searchbox", {
        name: "Starting song search",
    });
    await startSearch.fill(startSong.title);
    await page
        .getByRole("list", { name: "Starting song search results" })
        .getByRole("button", { name: new RegExp(startSong.title) })
        .click();

    const targetSearch = page.getByRole("searchbox", {
        name: "Destination song search",
    });
    await targetSearch.fill(targetSong.title);
    await page
        .getByRole("list", { name: "Destination song search results" })
        .getByRole("button", { name: new RegExp(targetSong.title) })
        .click();
    await page.getByRole("button", { name: "Start Race" }).click();
}

async function moveTo(page: Page, destination: FixtureSong) {
    await page
        .getByRole("button", {
            name: `Move to ${destination.title} by ${destination.artist}`,
        })
        .click();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getBacktrackingDemoRace() {
    const graph = demoGraphRegistry[0].graph;
    for (const startSongId of graph.nodes.keys()) {
        for (const targetSongId of graph.nodes.keys()) {
            const path = findShortestPath(graph, startSongId, targetSongId);
            if (!path || path.length < 3) continue;

            const abandonedSongId = (graph.edges.get(startSongId) ?? []).find(
                (songId) =>
                    !path.includes(songId) &&
                    findShortestPath(graph, songId, targetSongId) !== null,
            );
            if (abandonedSongId) {
                return {
                    graph,
                    start: graph.nodes.get(startSongId)!,
                    target: graph.nodes.get(targetSongId)!,
                    path: path.map((songId) => graph.nodes.get(songId)!),
                    abandoned: graph.nodes.get(abandonedSongId)!,
                };
            }
        }
    }

    throw new Error("Indie & Alternative needs a custom route with a backtracking branch.");
}

test.describe("end-to-end gameplay", () => {
    test("plays offline Custom races across curated networks, backtracks, and shows the shortest-path benchmark", async ({
        page,
    }) => {
        const musicRequests: string[] = [];
        await page.route("**/api/music/**", async (route) => {
            musicRequests.push(new URL(route.request().url()).pathname);
            await route.fulfill({ status: 503, json: { error: "Unexpected Demo request" } });
        });
        await page.goto("/game");
        await page.getByRole("combobox", { name: "Race mode" }).selectOption("custom");

        const network = page.getByRole("combobox", {
            name: "Curated music network",
        });
        await expect(network.locator("option")).toHaveCount(6);
        const startSearch = page.getByRole("searchbox", {
            name: "Starting song search",
        });
        await expect(
            page.getByRole("list", { name: "Starting song search results" })
                .getByRole("button"),
        ).toHaveCount(40);

        const firstSong = demoGraphRegistry[0].graph.nodes.values().next().value;
        if (!firstSong) throw new Error("Indie & Alternative has no songs.");
        await startSearch.fill("not in this network");
        await expect(
            page.getByRole("status").filter({
                hasText: "No songs match this search in the selected network.",
            }),
        ).toBeVisible();
        await startSearch.fill(firstSong.title.slice(0, 4).toUpperCase());
        const startResult = page
            .getByRole("list", { name: "Starting song search results" })
            .getByRole("button", {
                name: new RegExp(
                    `${escapeRegExp(firstSong.title)}.*${escapeRegExp(firstSong.artist)}`,
                ),
            })
            .first();
        await startSearch.press("Tab");
        await expect(startResult).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByText("Selected origin")).toBeVisible();

        await network.selectOption("classic-rock");
        await expect(page.getByText("Selected origin")).toHaveCount(0);
        await startSearch.fill("");
        await expect(page.getByRole("list", { name: "Starting song search results" })
            .getByRole("button")).toHaveCount(40);
        for (const { id, name } of demoGraphRegistry) {
            await network.selectOption(id);
            await expect(network).toHaveValue(id);
            await expect(
                page.getByText(new RegExp(`Currently playing: ${escapeRegExp(name)} · 40 songs`)),
            ).toBeVisible();
        }

        await network.selectOption("indie-alternative");
        const race = getBacktrackingDemoRace();
        await startSearch.fill(race.start.title);
        await page
            .getByRole("list", { name: "Starting song search results" })
            .getByRole("button", {
                name: new RegExp(
                    `${escapeRegExp(race.start.title)}.*${escapeRegExp(race.start.artist)}`,
                ),
            })
            .first()
            .click();

        const targetSearch = page.getByRole("searchbox", {
            name: "Destination song search",
        });
        await targetSearch.fill(race.start.title);
        const duplicate = page
            .getByRole("list", { name: "Destination song search results" })
            .getByRole("button", {
                name: new RegExp(
                    `${escapeRegExp(race.start.title)}.*${escapeRegExp(race.start.artist)}`,
                ),
            })
            .first();
        await expect(duplicate).toBeDisabled();
        await targetSearch.fill(race.target.title);
        await page
            .getByRole("list", { name: "Destination song search results" })
            .getByRole("button", {
                name: new RegExp(
                    `${escapeRegExp(race.target.title)}.*${escapeRegExp(race.target.artist)}`,
                ),
            })
            .first()
            .click();
        await page.getByRole("button", { name: "Start Race" }).click();

        await moveTo(page, race.abandoned);
        await page.getByRole("button", { name: "Back to previous song" }).click();
        for (const song of race.path.slice(1)) {
            await moveTo(page, {
                id: song.id,
                title: song.title,
                artist: song.artist,
                albumArt: song.albumArt,
            });
        }

        await expect(page.getByRole("heading", { name: "Signal Acquired" })).toBeVisible();
        await expect(page.getByText(
            `Route from ${race.start.title} by ${race.start.artist} to ${race.target.title} by ${race.target.artist}.`,
        )).toBeVisible();
        await expect(page.getByText("Shortest directed path in the selected curated network; the route was not revealed before victory."))
            .toBeVisible();
        const completedRoute = page.getByRole("list", {
            name: "Completed route in order",
        });
        await expect(completedRoute.locator("li")).toHaveCount(race.path.length);
        await expect(completedRoute).not.toContainText(race.abandoned.title);

        await page.getByRole("button", { name: "Restart current race" }).click();
        await expect(page.getByRole("heading", { name: "Current song" })).toBeVisible();
        await expect(
            page.getByRole("region", {
                name: `Destination: ${race.target.title} by ${race.target.artist}`,
            }),
        ).toBeVisible();
        await page.getByRole("button", { name: "New Custom Race" }).click();
        await expect(page.getByText("Selected origin")).toHaveCount(0);
        await expect(page.getByText("Selected destination")).toHaveCount(0);
        await expect(network.locator("option")).toHaveCount(6);
        await expect(page.getByRole("combobox", { name: "Race difficulty" })).toHaveCount(0);
        await page.getByRole("combobox", { name: "Race mode" }).selectOption("random");
        await expect(page.getByRole("heading", { name: "Link the songs" })).toBeVisible();
        await page.getByRole("combobox", { name: "Race mode" }).selectOption("custom");
        await expect(page.getByRole("list", { name: "Starting song search results" })
            .getByRole("button")).toHaveCount(40);

        for (const width of [320, 390, 768, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            const dimensions = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                content: document.documentElement.scrollWidth,
            }));
            expect(dimensions.content, `Custom setup overflows at ${width}px`)
                .toBeLessThanOrEqual(dimensions.viewport);
        }
        expect(musicRequests).toEqual([]);
    });

    test("renders artwork safely and continues gameplay through missing and failed images", async ({
        page,
    }) => {
        const start = song(
            "Artwork Start",
            "/art/slow.svg",
        );
        const middle = song(
            "Artwork Middle",
            "/art/broken.svg",
        );
        const placeholderArtwork = song(
            "Artwork Placeholder",
            "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png",
        );
        const missingArtwork = song("Artwork Unavailable");
        const target = song(
            "Artwork Destination",
            "/art/valid.svg",
        );
        const destinationWithArt = target;
        let releaseSlowImage: (() => void) | undefined;
        let notifySlowImage: (() => void) | undefined;
        const slowImageRequested = new Promise<void>((resolve) => {
            notifySlowImage = resolve;
        });
        const slowImageGate = new Promise<void>((resolve) => {
            releaseSlowImage = resolve;
        });
        let placeholderRequests = 0;
        let artworkLookupRequests = 0;

        await page.route("**/api/music/search**", async (route) => {
            const query = new URL(route.request().url()).searchParams.get("query");
            const match = [start, target].find(
                (item) => item.title.toLowerCase() === query?.toLowerCase(),
            );
            await route.fulfill({ json: { songs: match ? [match] : [] } });
        });
        await page.route("**/api/music/similar**", async (route) => {
            const songId = new URL(route.request().url()).searchParams.get("songId");
            const recommendations =
                songId === start.id
                    ? [middle, placeholderArtwork, missingArtwork]
                    : songId === middle.id
                      ? [destinationWithArt]
                      : [];
            await route.fulfill({ json: { songs: recommendations } });
        });
        await page.route("**/api/music/artwork**", async (route) => {
            artworkLookupRequests += 1;
            await route.abort();
        });
        await page.route("**/2a96cbd8b46e442fc41c2b86b821562f.png", async (route) => {
            placeholderRequests += 1;
            await route.abort();
        });
        await page.route("**/art/**", async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path === "/art/slow.svg") {
                notifySlowImage?.();
                await slowImageGate;
                await route.fulfill({ status: 404, body: "" });
                return;
            }
            if (path === "/art/valid.svg") {
                await route.fulfill({
                    contentType: "image/svg+xml",
                    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#527665"/></svg>',
                });
                return;
            }
            await route.fulfill({ status: 404, body: "" });
        });

        await page.goto("/game");
        await startCustomRace(page, start, target);
        await expect(
            page.locator('[aria-label^="Current song:"] .radio-album-art img'),
        ).toHaveAttribute("src", start.albumArt);
        const slowImageRequestedWait = slowImageRequested;
        await slowImageRequestedWait;
        await expect(
            page
                .getByRole("button", {
                    name: `Move to ${placeholderArtwork.title} by ${placeholderArtwork.artist}`,
                })
                .locator(".radio-album-art-fallback"),
        ).toBeVisible();
        await expect(
            page
                .getByRole("button", {
                    name: `Move to ${missingArtwork.title} by ${missingArtwork.artist}`,
                })
                .locator(".radio-album-art-fallback"),
        ).toBeVisible();

        await moveTo(page, middle);
        const middleCard = page.locator('[aria-label^="Current song:"]');
        await expect(middleCard.locator(".radio-album-art-fallback")).toBeVisible();
        await expect(
            page.getByRole("button", {
                name: `Move to ${destinationWithArt.title} by ${destinationWithArt.artist}`,
            }),
        ).toBeVisible();

        await moveTo(page, destinationWithArt);
        const destinationCard = page.locator('[aria-label^="Current song:"]');
        await expect(
            destinationCard.locator(".radio-album-art img"),
        ).toHaveAttribute("src", destinationWithArt.albumArt);
        await expect(page.getByRole("heading", { name: "Signal Acquired" })).toBeVisible();
        await expect(
            page.getByRole("list", { name: "Completed route in order" }).locator("li"),
        ).toHaveCount(3);

        releaseSlowImage?.();
        await expect(
            page.getByRole("list", { name: "Completed route in order" })
                .locator("li")
                .nth(2)
                .locator(".radio-album-art img"),
        ).toHaveAttribute("src", destinationWithArt.albumArt);
        await expect
            .poll(() => placeholderRequests)
            .toBe(0);
        expect(artworkLookupRequests).toBe(0);
    });

    test("plays a deterministic hard random race, preserves it on Restart, and creates a different valid race", async ({
        page,
    }) => {
        await page.addInitScript(() => {
            Math.random = () => 0;
        });

        const fixture = await installRandomGraph(page);
        await page.goto("/game");
        await page.getByRole("combobox", { name: "Race difficulty" }).selectOption("hard");
        await page.getByRole("combobox", { name: "Song source" }).selectOption("lastfm");
        await expect(page.getByRole("heading", { name: "Link the songs" })).toBeVisible();
        expect(fixture.requestCount).toBe(1);

        const initialStart = page.getByText("Race One Start", { exact: true }).first();
        const initialTarget = page.getByText("Race One Finish", { exact: true }).first();
        await expect(initialStart).toBeVisible();
        await expect(initialTarget).toBeVisible();
        await moveTo(page, randomFixtureSongs[1]);
        await moveTo(page, randomFixtureSongs[3]);
        await moveTo(page, randomFixtureSongs[4]);
        await moveTo(page, randomFixtureSongs[5]);

        const victory = page.getByRole("region", { name: "Signal Acquired" });
        await expect(page.getByRole("status")).toContainText(
            "Signal Acquired. Destination reached: Race One Finish by Fixture Artist.",
        );
        await expect(victory).toContainText(
            "Destination reached: Race One Finish by Fixture Artist",
        );
        await expect(
            page.getByRole("complementary", { name: "Navigation panel" }),
        ).toHaveCount(0);
        await expect(victory.getByRole("heading", { name: "Signal Acquired" })).toBeVisible();
        await expect(victory.getByRole("list", { name: "Completed route in order" }).locator("li")).toHaveCount(5);
        await expect(victory).toContainText("Original race-graph benchmark");
        await expect(victory).toContainText("Matched the original race-graph benchmark.");
        await expect(victory.getByRole("list", { name: "Completed route in order" }).locator("li").first()).toContainText("Race One Start");
        await expect(victory.getByRole("list", { name: "Completed route in order" }).locator("li").last()).toContainText("Race One Finish");

        await page.getByRole("button", { name: "Restart current race" }).click();
        await expect(page.getByText("Race One Start", { exact: true }).first()).toBeVisible();
        await expect(page.locator('[aria-label$="moves"]').first()).toContainText("0 moves");
        await expect(page.getByRole("button", { name: "Move to Race One Left by Fixture Artist" })).toBeVisible();

        await page.getByRole("button", { name: "New Race" }).click();
        await expect(page.getByText("Race Two Start", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("Race Two Finish", { exact: true }).first()).toBeVisible();
        await expect(page.getByRole("combobox", { name: "Race difficulty" })).toHaveValue("hard");
    });

    test("explains disabled Last.fm and keeps Demo playable without provider requests", async ({ page }) => {
        const musicRequests: string[] = [];
        await page.route("**/api/music/**", async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            musicRequests.push(pathname);
            await route.fulfill({
                status: 503,
                json: {
                    code: "live_music_disabled",
                    error: "Live Last.fm functionality is disabled. Demo mode is available.",
                },
            });
        });
        await page.goto("/game");
        await expect(page.getByRole("combobox", { name: "Song source" })).toHaveValue("demo");
        await expect(page.getByRole("heading", { name: "Link the songs" })).toBeVisible();
        await expect(page.getByRole("button", { name: "New Race" })).toBeVisible();

        await page.getByRole("combobox", { name: "Song source" }).selectOption("lastfm");
        await expect(page.getByRole("alert")).toContainText(
            "Live Last.fm functionality is disabled. Demo mode is available.",
        );
        await page.getByRole("combobox", { name: "Song source" }).selectOption("demo");
        await expect(page.getByRole("heading", { name: "Link the songs" })).toBeVisible();

        const demoRequestCount = musicRequests.length;
        const networkSelector = page.getByRole("combobox", {
            name: "Curated music network",
        });
        await expect(networkSelector).toHaveValue("indie-alternative");
        await expect(
            page.getByRole("list", { name: "Curated music connections" }),
        ).toBeVisible();
        await networkSelector.selectOption("classic-rock");
        await expect(page.getByText(/Currently playing: Classic Rock · 40 songs/))
            .toBeVisible();
        await page.getByRole("combobox", { name: "Race difficulty" })
            .selectOption("hard");
        await expect(page.getByRole("combobox", { name: "Race difficulty" }))
            .toHaveValue("hard");

        const previousSong = await page
            .locator('[aria-label^="Current song:"]')
            .getAttribute("aria-label");
        await page
            .getByRole("list", { name: "Curated music connections" })
            .getByRole("button")
            .first()
            .click();
        await expect(page.locator('[aria-label^="Current song:"]')).not.toHaveAttribute(
            "aria-label",
            previousSong!,
        );
        await page.getByRole("button", { name: "Restart current race" }).click();
        await expect(page.getByText(/Currently playing: Classic Rock · 40 songs/))
            .toBeVisible();
        expect(musicRequests).toHaveLength(demoRequestCount);
        expect(musicRequests).toEqual(["/api/music/graph"]);
    });

    test("selects all curated networks by keyboard and Surprise Me changes only on New Race", async ({
        page,
    }) => {
        const musicRequests: string[] = [];
        await page.addInitScript(() => {
            Math.random = () => 0;
        });
        await page.route("**/api/music/**", async (route) => {
            musicRequests.push(new URL(route.request().url()).pathname);
            await route.fulfill({ status: 503, json: { code: "unexpected" } });
        });
        await page.goto("/game");

        const network = page.getByRole("combobox", {
            name: "Curated music network",
        });
        await expect(network).toHaveValue("indie-alternative");
        await expect(network.locator("option")).toHaveCount(7);
        await network.focus();
        await network.press("c");
        await network.press("Enter");
        await expect(network).toHaveValue("classic-rock");
        await expect(page.getByText(/Currently playing: Classic Rock · 40 songs/))
            .toBeVisible();

        for (const [id, name] of [
            ["indie-alternative", "Indie & Alternative"],
            ["pop", "Pop"],
            ["hip-hop", "Hip-Hop"],
            ["electronic", "Electronic"],
            ["across-the-decades", "Across the Decades"],
        ]) {
            await network.selectOption(id);
            await expect(network).toHaveValue(id);
            await expect(
                page.getByText(new RegExp(`Currently playing: ${name} · 40 songs`)),
            ).toBeVisible();
        }

        await network.selectOption("surprise-me");
        await expect(network).toHaveValue("surprise-me");
        const activeDescription = page.getByText(/Currently playing:/);
        const selectedNetwork = await activeDescription.textContent();
        const startBeforeRestart = await page
            .locator('[aria-label^="Current song:"]')
            .getAttribute("aria-label");
        await page.getByRole("button", { name: "Restart current race" }).click();
        await expect(activeDescription).toHaveText(selectedNetwork!);
        await expect(page.locator('[aria-label^="Current song:"]')).toHaveAttribute(
            "aria-label",
            startBeforeRestart!,
        );

        await page.getByRole("button", { name: "New Race" }).click();
        await expect(activeDescription).not.toHaveText(selectedNetwork!);
        await expect(page.locator('[aria-label^="Current song:"]')).not.toHaveAttribute(
            "aria-label",
            startBeforeRestart!,
        );
        expect(musicRequests).toEqual([]);
    });

    test("expands an unvisited custom song once, reuses it after Back, and wins", async ({
        page,
    }) => {
        const start = song("Explorer Start");
        const branch = song("Explorer Branch");
        const target = song("Explorer Destination");
        const calls = new Map<string, number>();
        let graphRequests = 0;
        page.on("request", (request) => {
            if (new URL(request.url()).pathname === "/api/music/graph") {
                graphRequests += 1;
            }
        });
        await page.route("**/api/music/similar**", async (route) => {
            const id = new URL(route.request().url()).searchParams.get("songId")!;
            calls.set(id, (calls.get(id) ?? 0) + 1);
            const recommendations =
                id === start.id ? [branch] : id === branch.id ? [target] : [];
            await route.fulfill({ json: { songs: recommendations } });
        });
        await page.goto("/game");
        await startCustomRace(page, start, target);
        expect(graphRequests).toBe(0);
        await expect(page.getByRole("button", { name: `Move to ${branch.title} by ${branch.artist}` })).toBeVisible();
        expect(calls.get(start.id)).toBe(1);

        await moveTo(page, branch);
        await expect(page.getByRole("button", { name: `Move to ${target.title} by ${target.artist}` })).toBeVisible();
        expect(calls.get(branch.id)).toBe(1);
        await page.getByRole("button", { name: "Back to previous song" }).last().click();
        await moveTo(page, branch);
        await expect(page.getByRole("button", { name: `Move to ${target.title} by ${target.artist}` })).toBeVisible();
        expect(calls.get(branch.id)).toBe(1);

        await moveTo(page, target);
        const victory = page.getByRole("region", { name: "Signal Acquired" });
        await expect(page.getByRole("status")).toContainText(
            `Signal Acquired. Destination reached: ${target.title} by ${target.artist}.`,
        );
        await expect(victory.getByRole("heading", { name: "Signal Acquired" })).toBeVisible();
        await expect(victory).toContainText("Final active-route moves");
        await expect(victory).toContainText("Unavailable for live custom races");
        const route = victory.getByRole("list", { name: "Completed route in order" });
        await expect(route.locator("li")).toHaveCount(3);
        await expect(route.locator("li").nth(0)).toContainText(start.title);
        await expect(route.locator("li").nth(1)).toContainText(branch.title);
        await expect(route.locator("li").nth(2)).toContainText(target.title);
        await page.getByRole("button", { name: "Restart current race" }).click();
        await expect(page.locator('[aria-label^="Current song:"]')).toHaveAttribute(
            "aria-label",
            `Current song: ${start.title} by ${start.artist}`,
        );
        await moveTo(page, branch);
        await moveTo(page, target);
        await expect(page.getByRole("heading", { name: "Signal Acquired" })).toBeVisible();
        await page.getByRole("button", { name: "New Custom Race" }).click();
        await expect(page.getByRole("heading", { name: "Build a custom race" })).toBeVisible();
    });

    test("shows only the active completed route after recovery and supports a long custom route", async ({
        page,
    }) => {
        const start = song("Transmission Start");
        const abandoned = song("Abandoned Branch");
        const activeBranch = song("Active Branch");
        const middle = song("Long Route Middle One");
        const middleTwo = song("Long Route Middle Two");
        const middleThree = song("Long Route Middle Three");
        const middleFour = song("Long Route Middle Four");
        const target = song("Transmission Destination");
        const routeSongs = [
            start,
            activeBranch,
            middle,
            middleTwo,
            middleThree,
            middleFour,
            target,
        ];
        await page.route("**/api/music/similar**", async (route) => {
            const id = new URL(route.request().url()).searchParams.get("songId");
            const recommendations =
                id === start.id
                    ? [abandoned, activeBranch]
                    : id === abandoned.id
                      ? []
                      : routeSongs[
                            routeSongs.findIndex((item) => item.id === id) + 1
                        ]
                        ? [
                              routeSongs[
                                  routeSongs.findIndex((item) => item.id === id) + 1
                              ],
                          ]
                        : [];
            await route.fulfill({ json: { songs: recommendations } });
        });

        await page.goto("/game");
        await startCustomRace(page, start, target);
        await moveTo(page, abandoned);
        await expect(page.getByRole("status")).toContainText(
            "Recommendations for this song loaded successfully",
        );
        await page.getByRole("button", { name: "Back to previous song" }).last().click();
        await moveTo(page, activeBranch);
        for (const songToVisit of routeSongs.slice(2)) {
            await moveTo(page, songToVisit);
        }

        const victory = page.getByRole("region", { name: "Signal Acquired" });
        const routeLog = victory.getByRole("list", {
            name: "Completed route in order",
        });
        await expect(routeLog.locator("li")).toHaveCount(routeSongs.length);
        await expect(routeLog).not.toContainText(abandoned.title);
        for (const [index, item] of routeSongs.entries()) {
            await expect(routeLog.locator("li").nth(index)).toContainText(item.title);
            await expect(routeLog.locator("li").nth(index)).toContainText(item.artist);
        }

        await page.setViewportSize({ width: 320, height: 900 });
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(320);
    });

    test("recovers from an expanded dead end by going Back and taking an alternate route", async ({
        page,
    }) => {
        const start = song("Dead End Start");
        const deadEnd = song("Dead End Song");
        const target = song("Recovery Destination");
        await page.route("**/api/music/similar**", async (route) => {
            const id = new URL(route.request().url()).searchParams.get("songId");
            const recommendations = id === start.id ? [deadEnd, target] : [];
            await route.fulfill({ json: { songs: recommendations } });
        });
        await page.goto("/game");
        await startCustomRace(page, start, target);
        await moveTo(page, deadEnd);
        await expect(page.getByRole("status")).toContainText(
            "Recommendations for this song loaded successfully",
        );
        await expect(
            page.getByRole("button", { name: "Back to previous song" }).last(),
        ).toBeVisible();
        await page.getByRole("button", { name: "Back to previous song" }).last().click();
        await moveTo(page, target);
        await expect(
            page.getByRole("region", { name: "Signal Acquired" }),
        ).toContainText("Destination reached");
    });

    test("preserves route progress after expansion failure and retries successfully", async ({
        page,
    }) => {
        const start = song("Retry Start");
        const middle = song("Retry Middle");
        const target = song("Retry Destination");
        const attempts = new Map<string, number>();
        await page.route("**/api/music/similar**", async (route) => {
            const id = new URL(route.request().url()).searchParams.get("songId")!;
            const attempt = (attempts.get(id) ?? 0) + 1;
            attempts.set(id, attempt);
            if (id === middle.id && attempt === 1) {
                await route.fulfill({
                    status: 502,
                    json: { error: "internal provider detail" },
                });
                return;
            }
            await route.fulfill({
                json: {
                    songs:
                        id === start.id ? [middle] : id === middle.id ? [target] : [],
                },
            });
        });
        await page.goto("/game");
        await startCustomRace(page, start, target);
        await moveTo(page, middle);
        await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
        await expect(page.getByRole("alert")).not.toContainText("internal provider detail");
        await expect(page.locator('[aria-label^="Current song:"]')).toHaveAttribute(
            "aria-label",
            `Current song: ${middle.title} by ${middle.artist}`,
        );
        await expect(page.locator('[aria-label$="moves"]').first()).toContainText("1 move");
        await page.getByRole("button", { name: "Retry recommendations" }).click();
        await expect(page.getByRole("button", { name: `Move to ${target.title} by ${target.artist}` })).toBeVisible();
        expect(attempts.get(middle.id)).toBe(2);
        await moveTo(page, target);
        const victory = page.getByRole("region", { name: "Signal Acquired" });
        await expect(victory).toContainText("Final active-route moves");
        await expect(victory.locator(".radio-victory-stat").first().locator("dd")).toContainText("2");
    });

    test("ignores an old custom-race response after switching back to Random mode", async ({
        page,
    }) => {
        const start = song("Stale Start");
        const target = song("Stale Destination");
        let releaseResponse: (() => void) | undefined;
        let notifyRequest: (() => void) | undefined;
        const requestSeen = new Promise<void>((resolve) => {
            notifyRequest = resolve;
        });
        const responseGate = new Promise<void>((resolve) => {
            releaseResponse = resolve;
        });
        await page.route("**/api/music/similar**", async (route) => {
            notifyRequest?.();
            await responseGate;
            await route.fulfill({
                json: { songs: [song("Stale Recommendation")] },
            });
        });
        await page.route("**/api/music/graph**", async (route) => {
            await route.fulfill({ json: randomFixtureGraph });
        });
        await page.goto("/game");
        await startCustomRace(page, start, target);
        await requestSeen;

        await page.getByRole("combobox", { name: "Race mode" }).selectOption("random");
        const demoStart = await page.locator('[aria-label^="Current song:"]').getAttribute("aria-label");
        releaseResponse?.();
        await expect(page.getByRole("heading", { name: "Link the songs" })).toBeVisible();
        await expect(page.locator('[aria-label^="Current song:"]')).toHaveAttribute(
            "aria-label",
            demoStart!,
        );
        await expect(page.getByText("Stale Recommendation", { exact: true })).toHaveCount(0);
    });

    test("keeps search results current, prevents duplicate endpoints, and verifies zoom and viewport layouts", async ({
        page,
    }) => {
        const fast = song("Fast Search Result");
        const slow = song("Stale Search Result");
        const other = song("Distinct Search Destination");
        await page.route("**/api/music/search**", async (route: Route) => {
            const query = new URL(route.request().url()).searchParams.get("query");
            if (query === "slow") {
                await new Promise((resolve) => setTimeout(resolve, 600));
                await route.fulfill({ json: { songs: [slow] } });
            } else if (query === "fast") {
                await route.fulfill({ json: { songs: [fast] } });
            } else if (query === "same") {
                await route.fulfill({ json: { songs: [fast] } });
            } else {
                await route.fulfill({ json: { songs: [other] } });
            }
        });
        await page.goto("/game");
        await page.getByRole("combobox", { name: "Race mode" }).selectOption("custom");
        await page.getByRole("combobox", { name: "Song source" }).selectOption("lastfm");
        const startSearch = page.getByRole("searchbox", { name: "Starting song search" });
        await startSearch.fill("slow");
        await page.waitForTimeout(350);
        await startSearch.fill("fast");
        const startResults = page.getByRole("list", { name: "Starting song search results" });
        await expect(startResults.getByRole("button", { name: new RegExp(fast.title) })).toBeVisible();
        await expect(startResults.getByText(slow.title)).toHaveCount(0);
        await startResults.getByRole("button", { name: new RegExp(fast.title) }).click();

        const targetSearch = page.getByRole("searchbox", { name: "Destination song search" });
        await targetSearch.fill("same");
        const duplicateResults = page.getByRole("list", { name: "Destination song search results" });
        const duplicateResult = duplicateResults.getByRole("button", { name: new RegExp(fast.title) });
        await expect(duplicateResult).toBeDisabled();
        await expect(page.getByRole("button", { name: "Start Race" })).toBeDisabled();

        await targetSearch.fill("other");
        await page
            .getByRole("list", { name: "Destination song search results" })
            .getByRole("button", { name: new RegExp(other.title) })
            .click();

        for (const width of [320, 390, 768, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(width);
        }

        await page.setViewportSize({ width: 1280, height: 900 });
        const viewportBeforeZoom = await page.evaluate(() => innerWidth);
        for (let step = 0; step < 5; step += 1) {
            await page.keyboard.press("Control+Equal");
        }
        const browserZoomSupported = await page.evaluate(
            (baselineWidth) =>
                innerWidth < baselineWidth && devicePixelRatio >= 1.9,
            viewportBeforeZoom,
        );
        if (!browserZoomSupported) {
            await page.setViewportSize({ width: 640, height: 900 });
        }
        const zoomViewport = await page.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(zoomViewport.scrollWidth).toBeLessThanOrEqual(zoomViewport.width);
        if (browserZoomSupported) await page.keyboard.press("Control+0");
    });
});
