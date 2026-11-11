/**
 * The model behind the component browser view (views/componentBrowser.ts):
 * bus → connection → fields, built from the XML index of the active profile.
 * vscode-free, so it is unit-tested directly; the view only maps these nodes
 * onto TreeItems.
 *
 * Nothing here decides what is valid in a script — it only lists what the
 * index holds. Connections are grouped by their `Bus` and sorted by name;
 * fields keep the order the config file declares them in.
 */
import { Bus, ConnectionDef, FieldDef, MessageDef, XmlIndex } from "./xmlIndex";

/**
 * Display name per bus. A `Record<Bus, …>`, so a new `Bus` value fails to
 * compile until it is listed here; the key order is the order of the groups.
 */
const BUS_LABELS: Record<Bus, string> = {
  "429": "ARINC 429",
  "1553": "MIL-STD-1553",
  DIS: "Discrete",
  Mem: "Memory",
  VORILS: "VORILS",
  ED: "External Data",
};

const BUS_ORDER = Object.keys(BUS_LABELS) as Bus[];

export interface FieldNode {
  kind: "field";
  /** The field name, as a script writes it left of `=`. */
  name: string;
  /** Full name of the connection this field is listed under. */
  connectionName: string;
  /** Type / range / unit / enum summary; "" when the index holds none. */
  description: string;
  field: FieldDef;
  message: MessageDef;
}

export interface ConnectionNode {
  kind: "connection";
  /** Bus-prefixed name — the section tag name a script writes. */
  name: string;
  bus: Bus;
  /** Message name and field count; "" when the connection has no message. */
  description: string;
  connection: ConnectionDef;
  message?: MessageDef;
  /** Fields in declaration order (only the matching ones under a filter). */
  fields: FieldNode[];
  /** Number of fields of the message, whatever the filter shows. */
  fieldCount: number;
}

export interface BusNode {
  kind: "bus";
  bus: Bus;
  label: string;
  connections: ConnectionNode[];
}

export type ComponentNode = BusNode | ConnectionNode | FieldNode;

export interface ComponentTree {
  buses: BusNode[];
  /** Connections shown (after filtering). */
  connectionCount: number;
  /** Connections in the index (before filtering). */
  totalConnections: number;
}

const isSet = (value: string | undefined): value is string =>
  value !== undefined && value !== "" && value !== "-";

/**
 * One-line summary of a field: data type, range, resolution, unit, number of
 * enum values, and whether the config marks it reserved. Only what the index
 * recorded — parts it does not hold are left out.
 */
export function fieldSummary(field: FieldDef): string {
  const parts: string[] = [];
  if (isSet(field.dataType)) {
    parts.push(field.dataType);
  }
  const min = isSet(field.minValue) ? field.minValue : undefined;
  const max = isSet(field.maxValue) ? field.maxValue : undefined;
  if (min !== undefined && max !== undefined) {
    parts.push(`${min} … ${max}`);
  } else if (min !== undefined) {
    parts.push(`min ${min}`);
  } else if (max !== undefined) {
    parts.push(`max ${max}`);
  }
  if (isSet(field.resolution)) {
    parts.push(`step ${field.resolution}`);
  }
  if (isSet(field.unit)) {
    parts.push(field.unit);
  }
  const enums = field.enums?.length ?? 0;
  if (enums > 0) {
    parts.push(`${enums} enum ${enums === 1 ? "value" : "values"}`);
  }
  if (field.used === false) {
    parts.push("reserved");
  }
  return parts.join(" · ");
}

function connectionSummary(message: MessageDef | undefined): string {
  if (!message) {
    return "";
  }
  const n = message.fields.length;
  return `${message.name} · ${n} ${n === 1 ? "field" : "fields"}`;
}

/** Case-insensitive, digit runs by value (`input2` before `input10`). */
export function compareNames(a: string, b: string): number {
  const byText = a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
  if (byText !== 0) {
    return byText;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The lower-cased, whitespace-separated terms of a search string. */
export function filterTerms(filter: string | undefined): string[] {
  return (filter ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");
}

const hasAll = (haystack: string, terms: readonly string[]): boolean =>
  terms.every((term) => haystack.includes(term));

function fieldHaystack(field: FieldDef): string {
  const enums = (field.enums ?? []).map((e) => e.name).join(" ");
  return `${field.name} ${enums}`.toLowerCase();
}

/**
 * Build the tree for `index`, narrowed by `filter`.
 *
 * Filter: every whitespace-separated term must be found, case-insensitively.
 * A connection whose own name (or message name) holds all terms is shown with
 * all its fields; otherwise it is shown with just the fields whose name or
 * enum value names hold all terms, and dropped when there is none. An empty
 * filter shows everything. A bus with nothing left is dropped.
 */
export function buildComponentTree(
  index: XmlIndex,
  filter?: string
): ComponentTree {
  const terms = filterTerms(filter);
  const byBus = new Map<Bus, ConnectionNode[]>();
  let connectionCount = 0;

  for (const connection of index.connections.values()) {
    const message = index.resolveConnectionMessage(connection.fullName);
    const allFields = message?.fields ?? [];
    let shown: readonly FieldDef[] = allFields;
    if (terms.length > 0) {
      const own = `${connection.fullName} ${message?.name ?? ""}`.toLowerCase();
      if (!hasAll(own, terms)) {
        shown = allFields.filter((f) => hasAll(fieldHaystack(f), terms));
        if (shown.length === 0) {
          continue;
        }
      }
    }
    const node: ConnectionNode = {
      kind: "connection",
      name: connection.fullName,
      bus: connection.bus,
      description: connectionSummary(message),
      connection,
      message,
      fieldCount: allFields.length,
      fields: message
        ? shown.map((field) => ({
            kind: "field",
            name: field.name,
            connectionName: connection.fullName,
            description: fieldSummary(field),
            field,
            message,
          }))
        : [],
    };
    const list = byBus.get(connection.bus);
    if (list) {
      list.push(node);
    } else {
      byBus.set(connection.bus, [node]);
    }
    connectionCount++;
  }

  const buses: BusNode[] = [];
  // Known buses in their fixed order, then anything the list does not know.
  const order = [
    ...BUS_ORDER,
    ...Array.from(byBus.keys()).filter((bus) => !BUS_ORDER.includes(bus)),
  ];
  for (const bus of order) {
    const connections = byBus.get(bus);
    if (!connections) {
      continue;
    }
    connections.sort((a, b) => compareNames(a.name, b.name));
    buses.push({ kind: "bus", bus, label: BUS_LABELS[bus] ?? bus, connections });
  }
  return { buses, connectionCount, totalConnections: index.connections.size };
}

/** Children of a node (the roots are `tree.buses`). */
export function childrenOf(node: ComponentNode): ComponentNode[] {
  if (node.kind === "bus") {
    return node.connections;
  }
  return node.kind === "connection" ? node.fields : [];
}

/** A connection node of `tree` by its full name. */
export function findConnectionNode(
  tree: ComponentTree,
  name: string
): ConnectionNode | undefined {
  for (const bus of tree.buses) {
    const found = bus.connections.find((c) => c.name === name);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * Stable id of a node, unique within a tree. Used as the TreeItem id so the
 * view keeps expansion and selection across refreshes.
 */
export function nodeId(node: ComponentNode): string {
  switch (node.kind) {
    case "bus":
      return `bus:${node.bus}`;
    case "connection":
      return `conn:${node.name}`;
    case "field":
      return `field:${node.connectionName}\u0000${node.name}`;
  }
}

/** What the view says above an empty or filtered tree. */
export type ComponentTreeState =
  | "noConfig" // no profile / no config files → no index
  | "empty" // an index, but it holds no connection
  | "noMatch" // connections, but the filter hides all of them
  | "ok";

export function treeState(
  tree: ComponentTree | undefined
): ComponentTreeState {
  if (!tree) {
    return "noConfig";
  }
  if (tree.totalConnections === 0) {
    return "empty";
  }
  return tree.connectionCount === 0 ? "noMatch" : "ok";
}
