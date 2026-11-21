import { COMPONENT_TAG_PREFIXES, ConnectionDef } from "./xmlIndex";

// One anchored matcher per component tag prefix, in COMPONENT_TAG_PREFIXES
// order (which is therefore the lookup priority). Built from the shared list
// so a new prefix needs no change here.
const PREFIX_MATCHERS: readonly RegExp[] = COMPONENT_TAG_PREFIXES.map(
  (prefix) => new RegExp(`^(?:${prefix})_`)
);

/**
 * Find the connection a BARE name refers to — the name with its bus prefix
 * left off (`L100SelectedCourseBNR_input1`, `Type1`, `RNEGeneralWritePSAlive`).
 *
 * Works for every prefix the index registers connections under: `429_`,
 * `1553_`, `DIS_`, `Mem_`, `VORILS<N>_`, `ED_` and `PART_<partition>_`. When
 * several buses carry the same bare name the first prefix in
 * COMPONENT_TAG_PREFIXES wins.
 */
export function findConnectionByBareName(
  connections: ReadonlyMap<string, ConnectionDef>,
  bareName: string
): ConnectionDef | undefined {
  if (bareName === "") {
    return undefined;
  }
  let best: ConnectionDef | undefined;
  let bestRank = PREFIX_MATCHERS.length;
  for (const conn of connections.values()) {
    if (!conn.fullName.endsWith(bareName)) {
      continue;
    }
    for (let rank = 0; rank < bestRank; rank++) {
      const m = PREFIX_MATCHERS[rank].exec(conn.fullName);
      if (m && conn.fullName.length === m[0].length + bareName.length) {
        best = conn;
        bestRank = rank;
        break;
      }
    }
    if (bestRank === 0) {
      break;
    }
  }
  return best;
}
