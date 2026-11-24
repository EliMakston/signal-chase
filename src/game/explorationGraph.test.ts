import { describe, expect, it } from "vitest";
import {
    getAvailableRecommendations,
    beginExplorationRace,
    initializeExplorationGraph,
    markSongExpanded,
    mergeRecommendations,
    songRequiresExpansion,
} from "./explorationGraph";
import type { Song, SongGraph } from "./types";

function song(id: string, title = `Title ${id}`): Song {
    return { id, title, artist: `Artist ${id}`, albumArt: "" };
}

function makeGraph(edges: Array<[string, string[]]>): SongGraph {
    const ids = new Set<string>();
    for (const [sourceId, targets] of edges) {
        ids.add(sourceId);
        for (const targetId of targets) ids.add(targetId);
    }
    return {
        nodes: new Map([...ids].map((id) => [id, song(id)])),
        edges: new Map(edges.map(([id, targets]) => [id, [...targets]])),
    };
}

describe("exploration graph", () => {
    it("keeps the original path benchmark unknown when the initial graph has no route", () => {
        const graph: SongGraph = {
            nodes: new Map([
                ["start", song("start")],
                ["target", song("target")],
            ]),
            edges: new Map([
                ["start", []],
                ["target", []],
            ]),
        };
        const state = initializeExplorationGraph(graph, "start", "target");

        expect(state.originalShortestPathDistance).toBeNull();
        expect(state.graph.edges.get("start")).toEqual([]);
    });

    it("initializes independent graph snapshots and freezes original shortest distance", () => {
        const original = makeGraph([
            ["start", ["middle"]],
            ["middle", ["target"]],
            ["target", []],
        ]);
        const state = initializeExplorationGraph(
            original,
            "start",
            "target",
            ["start", "middle"],
        );

        expect(state.originalShortestPathDistance).toBe(2);
        expect(state.expandedSongIds).toEqual(new Set(["start", "middle"]));
        expect(state.graph).not.toBe(original);
        expect(state.originalRaceGraph).not.toBe(original);
        expect(state.graph).not.toBe(state.originalRaceGraph);
        expect(state.graph.nodes.get("start")).not.toBe(original.nodes.get("start"));
        expect(state.graph.edges.get("start")).not.toBe(original.edges.get("start"));
    });

    it("uses explicit expansion knowledge instead of inferring it from outgoing edges", () => {
        const graph = makeGraph([
            ["start", ["middle"]],
            ["middle", ["target"]],
            ["target", []],
        ]);
        const state = initializeExplorationGraph(graph, "start", "target");

        expect(songRequiresExpansion(state, "start")).toBe(true);
        expect(songRequiresExpansion(state, "middle")).toBe(true);
        expect(songRequiresExpansion(state, "target")).toBe(true);

        const knownExpanded = initializeExplorationGraph(
            graph,
            "start",
            "target",
            ["start", "middle"],
        );
        expect(songRequiresExpansion(knownExpanded, "start")).toBe(false);
        expect(songRequiresExpansion(knownExpanded, "middle")).toBe(false);
        expect(songRequiresExpansion(knownExpanded, "target")).toBe(true);
    });

    it("treats an artificial empty-edge node as unexpanded until explicitly marked", () => {
        const graph = makeGraph([
            ["start", ["dead-end", "middle"]],
            ["dead-end", []],
            ["middle", ["target"]],
            ["target", []],
        ]);
        const state = initializeExplorationGraph(graph, "start", "target");

        expect(songRequiresExpansion(state, "dead-end")).toBe(true);
        const expanded = markSongExpanded(state, "dead-end");
        expect(songRequiresExpansion(expanded, "dead-end")).toBe(false);
        expect(state.expandedSongIds.has("dead-end")).toBe(false);
    });

    it("merges an empty successful result without creating edges and marks it expanded separately", () => {
        const state = initializeExplorationGraph(
            makeGraph([
                ["start", ["target"]],
                ["target", []],
            ]),
            "start",
            "target",
        );
        const merged = mergeRecommendations(state, "target", []);

        expect(merged.graph.edges.get("target")).toEqual([]);
        expect(songRequiresExpansion(merged, "target")).toBe(true);

        const expanded = markSongExpanded(merged, "target");
        expect(songRequiresExpansion(expanded, "target")).toBe(false);
        expect(expanded.expandedSongIds.has("target")).toBe(true);
    });

    it("deduplicates repeated songs and edges while preserving existing and incoming order", () => {
        const state = initializeExplorationGraph(
            makeGraph([
                ["start", ["target"]],
                ["target", ["existing"]],
                ["existing", []],
            ]),
            "start",
            "target",
        );
        const incoming = [
            song("existing", "Provider metadata must not replace original"),
            song("new-a"),
            song("new-a", "Duplicate metadata"),
            song("new-b"),
            song("target"),
        ];

        const merged = mergeRecommendations(state, "target", incoming);

        expect(merged.graph.edges.get("target")).toEqual([
            "existing",
            "new-a",
            "new-b",
            "target",
        ]);
        expect(merged.graph.nodes.get("existing")?.title).toBe("Title existing");
        expect(merged.graph.nodes.get("new-a")?.title).toBe("Title new-a");
        expect(merged.graph.edges.get("new-a")).toEqual([]);
        expect(getAvailableRecommendations(merged, "target").map(({ id }) => id))
            .toEqual(["existing", "new-a", "new-b", "target"]);
    });

    it("preserves cycles and cross-connections without adding reverse edges", () => {
        const state = initializeExplorationGraph(
            makeGraph([
                ["start", ["target"]],
                ["target", []],
            ]),
            "start",
            "target",
        );
        const withBranch = mergeRecommendations(state, "target", [
            song("branch"),
            song("shared"),
        ]);
        const withCrossConnection = mergeRecommendations(withBranch, "branch", [
            song("shared"),
            song("start"),
        ]);
        const withCycle = mergeRecommendations(withCrossConnection, "shared", [
            song("target"),
        ]);

        expect(withCycle.graph.edges.get("target")).toEqual(["branch", "shared"]);
        expect(withCycle.graph.edges.get("branch")).toEqual(["shared", "start"]);
        expect(withCycle.graph.edges.get("shared")).toEqual(["target"]);
        expect(withCycle.graph.edges.get("start")).toEqual(["target"]);
    });

    it("never mutates the input, original race graph, or prior exploration snapshot", () => {
        const source = makeGraph([
            ["start", ["target"]],
            ["target", []],
        ]);
        const originalSourceNodes = [...source.nodes];
        const originalSourceEdges = [...source.edges].map(([id, ids]) => [
            id,
            [...ids],
        ]);
        const state = initializeExplorationGraph(source, "start", "target");
        const originalGraph = state.originalRaceGraph;
        const previousGraph = state.graph;

        const merged = mergeRecommendations(state, "target", [song("new")]);

        expect([...source.nodes]).toEqual(originalSourceNodes);
        expect([...source.edges]).toEqual(originalSourceEdges);
        expect(originalGraph.nodes.has("new")).toBe(false);
        expect(originalGraph.edges.get("target")).toEqual([]);
        expect(previousGraph.nodes.has("new")).toBe(false);
        expect(previousGraph.edges.get("target")).toEqual([]);
        expect(merged.originalRaceGraph).toBe(originalGraph);
    });

    it("keeps the original path benchmark fixed when added edges shorten the route", () => {
        const state = initializeExplorationGraph(
            makeGraph([
                ["start", ["middle"]],
                ["middle", ["target"]],
                ["target", []],
            ]),
            "start",
            "target",
        );
        const merged = mergeRecommendations(state, "start", [song("target")]);

        expect(merged.originalShortestPathDistance).toBe(2);
        expect(merged.originalRaceGraph.edges.get("start")).toEqual(["middle"]);
        expect(merged.graph.edges.get("start")).toEqual(["middle", "target"]);
    });

    it("reuses dynamic recommendations for another race while benchmarking on the original graph", () => {
        const state = initializeExplorationGraph(
            makeGraph([
                ["start", ["middle"]],
                ["middle", ["target"]],
                ["target", ["other-start"]],
                ["other-start", ["other-target"]],
                ["other-target", []],
            ]),
            "start",
            "target",
        );
        const expanded = mergeRecommendations(state, "middle", [song("shortcut")]);
        const loaded = markSongExpanded(expanded, "middle");
        const nextRace = beginExplorationRace(
            loaded,
            "other-start",
            "other-target",
        );

        expect(nextRace.graph.nodes.has("shortcut")).toBe(true);
        expect(nextRace.expandedSongIds.has("middle")).toBe(true);
        expect(nextRace.originalShortestPathDistance).toBe(1);
        expect(nextRace.originalRaceGraph.nodes.has("shortcut")).toBe(false);
    });

    it("returns no recommendations for unknown songs and rejects invalid expansion operations", () => {
        const state = initializeExplorationGraph(
            makeGraph([
                ["start", ["target"]],
                ["target", []],
            ]),
            "start",
            "target",
        );

        expect(getAvailableRecommendations(state, "missing")).toEqual([]);
        expect(() => mergeRecommendations(state, "missing", [])).toThrow(
            RangeError,
        );
        expect(() => markSongExpanded(state, "missing")).toThrow(RangeError);
    });
});
