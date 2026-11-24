import type { SongGraph } from "./types";

export interface QualifyingPairAnalysis {
    startSongId: string;
    targetSongId: string;
    shortestPathMoves: 2 | 3 | 4 | 5;
    hasTwoSimpleRoutesWithinSevenMoves: boolean;
}

export interface GraphAnalysis {
    totalSongs: number;
    totalDirectedEdges: number;
    songsWithZeroOutgoingEdges: number;
    zeroOutgoingPercentage: number;
    averageOutgoingDegree: number;
    maximumOutgoingDegree: number;
    songsWithAtLeastTwoOutgoingEdges: number;
    stronglyConnectedComponentSizes: number[];
    largestStronglyConnectedComponentSize: number;
    qualifyingPairs: QualifyingPairAnalysis[];
    qualifyingPairsWithTwoRoutes: number;
    ignoredMalformedEntries: number;
}

interface SanitizedGraph {
    songIds: string[];
    adjacency: Map<string, string[]>;
    ignoredMalformedEntries: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isValidSong(value: unknown, id: unknown): id is string {
    return (
        typeof id === "string" &&
        isRecord(value) &&
        value.id === id &&
        typeof value.title === "string" &&
        typeof value.artist === "string" &&
        typeof value.albumArt === "string" &&
        (typeof value.lastFmUrl === "undefined" ||
            typeof value.lastFmUrl === "string")
    );
}

function sanitizeGraph(graph: SongGraph): SanitizedGraph {
    let ignoredMalformedEntries = 0;
    const nodesValue: unknown = graph?.nodes;
    const edgesValue: unknown = graph?.edges;
    const validSongIds: string[] = [];

    if (!(nodesValue instanceof Map)) {
        return {
            songIds: [],
            adjacency: new Map(),
            ignoredMalformedEntries: 1,
        };
    }

    for (const [id, song] of nodesValue) {
        if (isValidSong(song, id) && id.trim().length > 0) {
            validSongIds.push(id);
        } else {
            ignoredMalformedEntries += 1;
        }
    }

    const songIdSet = new Set(validSongIds);
    const adjacency = new Map<string, string[]>(
        validSongIds.map((songId) => [songId, []]),
    );
    if (!(edgesValue instanceof Map)) {
        return {
            songIds: validSongIds,
            adjacency,
            ignoredMalformedEntries: ignoredMalformedEntries + 1,
        };
    }

    for (const [sourceId, rawTargets] of edgesValue) {
        if (typeof sourceId !== "string" || !songIdSet.has(sourceId)) {
            ignoredMalformedEntries += 1;
            continue;
        }
        if (!Array.isArray(rawTargets)) {
            ignoredMalformedEntries += 1;
            continue;
        }

        const uniqueTargets = new Set<string>();
        const targets: unknown[] = rawTargets;
        for (const targetId of targets) {
            if (typeof targetId !== "string" || !songIdSet.has(targetId)) {
                ignoredMalformedEntries += 1;
                continue;
            }
            if (uniqueTargets.has(targetId)) {
                ignoredMalformedEntries += 1;
                continue;
            }
            uniqueTargets.add(targetId);
        }
        adjacency.set(sourceId, [...uniqueTargets]);
    }

    return { songIds: validSongIds, adjacency, ignoredMalformedEntries };
}

function breadthFirstDistances(
    adjacency: Map<string, string[]>,
    startSongId: string,
): Map<string, number> {
    const distances = new Map([[startSongId, 0]]);
    const queue = [startSongId];

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const currentSongId = queue[queueIndex];
        const currentDistance = distances.get(currentSongId);
        if (currentDistance === undefined) continue;
        const nextDistance = currentDistance + 1;
        for (const neighborId of adjacency.get(currentSongId) ?? []) {
            if (distances.has(neighborId)) continue;
            distances.set(neighborId, nextDistance);
            queue.push(neighborId);
        }
    }

    return distances;
}

function reverseAdjacency(
    songIds: string[],
    adjacency: Map<string, string[]>,
): Map<string, string[]> {
    const reverse = new Map<string, string[]>(
        songIds.map((songId) => [songId, []]),
    );
    for (const [sourceId, targets] of adjacency) {
        for (const targetId of targets) {
            reverse.get(targetId)?.push(sourceId);
        }
    }
    return reverse;
}

function hasTwoSimpleRoutes(
    startSongId: string,
    targetSongId: string,
    adjacency: Map<string, string[]>,
    distancesToTarget: Map<string, number>,
    maxMoves = 7,
): boolean {
    const visited = new Set([startSongId]);
    let routeCount = 0;

    function search(currentSongId: string, moves: number): void {
        if (routeCount >= 2 || moves >= maxMoves) return;

        for (const neighborId of adjacency.get(currentSongId) ?? []) {
            if (visited.has(neighborId)) continue;
            const nextMoves = moves + 1;
            const remainingMoves = maxMoves - nextMoves;
            const shortestRemaining = distancesToTarget.get(neighborId);
            if (
                shortestRemaining === undefined ||
                shortestRemaining > remainingMoves
            ) {
                continue;
            }

            if (neighborId === targetSongId) {
                routeCount += 1;
                if (routeCount >= 2) return;
                continue;
            }

            visited.add(neighborId);
            search(neighborId, nextMoves);
            visited.delete(neighborId);
            if (routeCount >= 2) return;
        }
    }

    search(startSongId, 0);
    return routeCount >= 2;
}

export function hasTwoSimpleDirectedRoutes(
    graph: SongGraph,
    startSongId: string,
    targetSongId: string,
    maxMoves = 7,
): boolean {
    if (
        !Number.isInteger(maxMoves) ||
        maxMoves < 1 ||
        startSongId === targetSongId
    ) {
        return false;
    }

    const { songIds, adjacency } = sanitizeGraph(graph);
    if (!adjacency.has(startSongId) || !adjacency.has(targetSongId)) {
        return false;
    }

    const reverse = reverseAdjacency(songIds, adjacency);
    const distancesToTarget = breadthFirstDistances(reverse, targetSongId);
    if (!distancesToTarget.has(startSongId)) return false;

    return hasTwoSimpleRoutes(
        startSongId,
        targetSongId,
        adjacency,
        distancesToTarget,
        maxMoves,
    );
}

function stronglyConnectedComponentSizes(
    songIds: string[],
    adjacency: Map<string, string[]>,
): number[] {
    const reverse = reverseAdjacency(songIds, adjacency);
    const visited = new Set<string>();
    const finishOrder: string[] = [];

    function visitForward(songId: string): void {
        visited.add(songId);
        for (const neighborId of adjacency.get(songId) ?? []) {
            if (!visited.has(neighborId)) visitForward(neighborId);
        }
        finishOrder.push(songId);
    }

    for (const songId of songIds) {
        if (!visited.has(songId)) visitForward(songId);
    }

    visited.clear();
    const sizes: number[] = [];
    function visitReverse(songId: string, component: Set<string>): void {
        visited.add(songId);
        component.add(songId);
        for (const neighborId of reverse.get(songId) ?? []) {
            if (!visited.has(neighborId)) visitReverse(neighborId, component);
        }
    }

    for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
        const songId = finishOrder[index];
        if (visited.has(songId)) continue;
        const component = new Set<string>();
        visitReverse(songId, component);
        sizes.push(component.size);
    }

    return sizes.sort((left, right) => right - left);
}

export function analyzeGraph(graph: SongGraph): GraphAnalysis {
    const {
        songIds,
        adjacency,
        ignoredMalformedEntries,
    } = sanitizeGraph(graph);
    const degrees = songIds.map((songId) => adjacency.get(songId)?.length ?? 0);
    const totalSongs = songIds.length;
    const songsWithZeroOutgoingEdges = degrees.filter((degree) => degree === 0).length;
    const totalDirectedEdges = degrees.reduce((sum, degree) => sum + degree, 0);
    const reverse = reverseAdjacency(songIds, adjacency);
    const distancesToTargets = new Map(
        songIds.map((targetSongId) => [
            targetSongId,
            breadthFirstDistances(reverse, targetSongId),
        ]),
    );
    const qualifyingPairs: QualifyingPairAnalysis[] = [];

    for (const startSongId of songIds) {
        const distancesFromStart = breadthFirstDistances(adjacency, startSongId);
        for (const targetSongId of songIds) {
            if (startSongId === targetSongId) continue;

            const distance = distancesFromStart.get(targetSongId);
            if (distance !== 2 && distance !== 3 && distance !== 4 && distance !== 5) {
                continue;
            }

            const distancesToTarget = distancesToTargets.get(targetSongId);
            if (!distancesToTarget) continue;
            const hasTwoRoutes = hasTwoSimpleRoutes(
                startSongId,
                targetSongId,
                adjacency,
                distancesToTarget,
            );
            qualifyingPairs.push({
                startSongId,
                targetSongId,
                shortestPathMoves: distance,
                hasTwoSimpleRoutesWithinSevenMoves: hasTwoRoutes,
            });
        }
    }

    const componentSizes = stronglyConnectedComponentSizes(songIds, adjacency);

    return {
        totalSongs,
        totalDirectedEdges,
        songsWithZeroOutgoingEdges,
        zeroOutgoingPercentage:
            totalSongs === 0 ? 0 : (songsWithZeroOutgoingEdges / totalSongs) * 100,
        averageOutgoingDegree:
            totalSongs === 0 ? 0 : totalDirectedEdges / totalSongs,
        maximumOutgoingDegree: degrees.length === 0 ? 0 : Math.max(...degrees),
        songsWithAtLeastTwoOutgoingEdges: degrees.filter((degree) => degree >= 2).length,
        stronglyConnectedComponentSizes: componentSizes,
        largestStronglyConnectedComponentSize: componentSizes[0] ?? 0,
        qualifyingPairs,
        qualifyingPairsWithTwoRoutes: qualifyingPairs.filter(
            (pair) => pair.hasTwoSimpleRoutesWithinSevenMoves,
        ).length,
        ignoredMalformedEntries,
    };
}
