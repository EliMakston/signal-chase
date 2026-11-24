import type { SongGraph } from "../types";
import { acrossTheDecadesGraph } from "./acrossTheDecades";
import { classicRockGraph } from "./classicRock";
import { electronicGraph } from "./electronic";
import { hipHopGraph } from "./hipHop";
import { indieAlternativeGraph } from "./indieAlternative";
import { popGraph } from "./pop";

export type DemoGraphId =
    | "indie-alternative"
    | "classic-rock"
    | "pop"
    | "hip-hop"
    | "electronic"
    | "across-the-decades";

export interface DemoGraphDefinition {
    readonly id: DemoGraphId;
    readonly name: string;
    readonly description: string;
    readonly source: "curated-demo";
    readonly graph: SongGraph;
}

export const demoGraphRegistry = [
    {
        id: "indie-alternative",
        name: "Indie & Alternative",
        description:
            "A curated route through indie rock, alternative, and independent pop from the 1990s onward.",
        source: "curated-demo",
        graph: indieAlternativeGraph,
    },
    {
        id: "classic-rock",
        name: "Classic Rock",
        description:
            "A curated network of landmark rock, blues-rock, folk-rock, and arena-rock recordings.",
        source: "curated-demo",
        graph: classicRockGraph,
    },
    {
        id: "pop",
        name: "Pop",
        description:
            "A curated path across dance-pop, synth-pop, R&B crossover, and contemporary pop.",
        source: "curated-demo",
        graph: popGraph,
    },
    {
        id: "hip-hop",
        name: "Hip-Hop",
        description:
            "A curated network of influential hip-hop records spanning foundational rap, regional scenes, and current chart hits.",
        source: "curated-demo",
        graph: hipHopGraph,
    },
    {
        id: "electronic",
        name: "Electronic",
        description:
            "A curated route across electronic pop, club music, house, breakbeats, and experimental electronica.",
        source: "curated-demo",
        graph: electronicGraph,
    },
    {
        id: "across-the-decades",
        name: "Across the Decades",
        description:
            "A curated, cross-era route through rock, soul, pop, hip-hop, and electronic music from the 1950s onward.",
        source: "curated-demo",
        graph: acrossTheDecadesGraph,
    },
] as const satisfies readonly DemoGraphDefinition[];

export type DemoGraphSelection = DemoGraphId | "surprise-me";

export const DEFAULT_DEMO_GRAPH_ID: DemoGraphId = "indie-alternative";

const demoGraphsById = new Map<string, DemoGraphDefinition>(
    demoGraphRegistry.map((definition) => [definition.id, definition]),
);

export function getDemoGraphDefinition(
    graphId: string,
): DemoGraphDefinition | undefined {
    return demoGraphsById.get(graphId);
}

export function chooseRandomDemoGraph(
    random: () => number = Math.random,
    excludeGraphId?: string,
): DemoGraphDefinition {
    const available = demoGraphRegistry.filter(
        ({ id }) => id !== excludeGraphId,
    );
    const candidates = available.length > 0 ? available : demoGraphRegistry;
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
        throw new RangeError("The random function must return a value in [0, 1).");
    }

    return candidates[Math.floor(sample * candidates.length)];
}
