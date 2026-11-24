# Curated Demo graph quality

These six networks are local, hand-curated Demo data. Their row order encodes
a musical cycle; each song connects to the two closest entries before and
after it. Each connection is bidirectional. This creates local alternatives
without using external recommendation data. Song titles and artist names are
plain text and no artwork, audio, lyrics, API results, or provider credentials
are bundled.

The report uses `analyzeGraph` to inspect graph integrity and eligible
start/target pairs. Race eligibility uses the current Easy (2–3 moves), Medium
(3–4), and Hard (4–5) shortest-path ranges. Alternative routes are distinct
simple directed routes of at most seven moves. Counts include ordered
start/target pairs.

| Curated network | Songs | Directed edges | Average out-degree | Dead ends | Largest SCC | Easy pairs | Medium pairs | Hard pairs | Eligible pairs with 2 routes | Unmet targets |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Indie & Alternative | 40 | 160 | 4.00 | 0 | 40 | 320 | 320 | 320 | 100% (640/640) | None |
| Classic Rock | 40 | 160 | 4.00 | 0 | 40 | 320 | 320 | 320 | 100% (640/640) | None |
| Pop | 40 | 160 | 4.00 | 0 | 40 | 320 | 320 | 320 | 100% (640/640) | None |
| Hip-Hop | 40 | 160 | 4.00 | 0 | 40 | 320 | 320 | 320 | 100% (640/640) | None |
| Electronic | 40 | 160 | 4.00 | 0 | 40 | 320 | 320 | 320 | 100% (640/640) | None |
| Across the Decades | 40 | 160 | 4.00 | 0 | 40 | 320 | 320 | 320 | 100% (640/640) | None |

The targets for song count (40–60), outgoing degree (4–8), dead ends (none),
connectivity, per-difficulty race candidates, and 80% alternative routes are
met by all six graphs. The focused registry tests verify edge destinations,
unique IDs, self-loop/duplicate-edge absence, connectivity, exact race counts,
pathfinding and race-generation compatibility, serialization determinism,
and no network calls through `MockMusicProvider`.
