import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";

export type Bus = "429" | "1553" | "Discrete" | "Mem";

/**
 * Single source of truth for bus prefixes used in `.esi` `[NAME]` references.
 *
 * `Discrete` accepts  `DIS_` — TestPit's PartitionAliases
 * (commented in MemoryPorts.xml) treat `DIS` as an alias for `Discrete`, and
 * scripts in the wild use both. Connections from MessageConfig
 * `<Device Type="Discrete">` and from DiscreteSignals.xml are dual-registered
 * under both prefixes so completion / hover / validation work either way.
 */
export const COMPONENT_TAG_PREFIXES = [
  "429",
  "1553",
  "DIS",
  "Mem",
] as const;

export const COMPONENT_TAG_PATTERN = new RegExp(
  `^(${COMPONENT_TAG_PREFIXES.join("|")})_`
);

const PREFIXES_BY_BUS: Record<Bus, string[]> = {
  "429": ["429_"],
  "1553": ["1553_"],
  Discrete: ["DIS_"],
  Mem: ["Mem_"],
};

export interface ConnectionDef {
  fullName: string;          // bus-prefixed, e.g. "429_L100SelectedCourseBNR_input1"
  bus: Bus;
  rawName: string;           // "L100SelectedCourseBNR_input1"
  messageName?: string;      // "SelectedCourseBNR" (extracted, may be undefined)
  label?: number;            // 100
  card?: string;
  channel?: string;
  speed?: string;
}

export interface EnumDef {
  name: string;
  value: string;
}

export interface FieldDef {
  name: string;              // "SDI"
  dataType?: string;         // "Enum" | "BNR" | "UInt8" | "UInt32" | ...
  startBit?: string;
  size?: string;
  minValue?: string;
  maxValue?: string;
  resolution?: string;
  defaultValue?: string;
  unit?: string;
  enums?: EnumDef[];
  vc?: boolean;
  parentMessage: string;     // "SelectedCourseBNR" — the message name this field belongs to
}

export interface MessageDef {
  name: string;              // "SelectedCourseBNR" (or memory port name, etc.)
  bus: Bus;
  label?: number;
  direction?: string;
  type?: string;             // "BNR" | "BCD" | "Enum" | ...
  minPeriod?: number;
  maxPeriod?: number;
  fields: FieldDef[];
}

export interface XmlIndex {
  connections: Map<string, ConnectionDef>;
  messages: Map<string, MessageDef>;
  resolveConnectionMessage(fullName: string): MessageDef | undefined;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

const CONNECTION_NAME_PATTERN = /^L(\d+)([A-Z][A-Za-z0-9]*?)(?:_\w+)?$/;
const BUS_PREFIX: Record<string, Bus> = {
  A429: "429",
  "1553": "1553",
  Discrete: "Discrete",
  Memory: "Mem",
};

export function parseConfigFolder(configFolderpath: string): XmlIndex {
  const index: XmlIndex = {
    connections: new Map(),
    messages: new Map(),
    resolveConnectionMessage(fullName) {
      const conn = this.connections.get(fullName);
      if (!conn || !conn.messageName) {
        return undefined;
      }
      return this.messages.get(conn.messageName);
    },
  };

  if (!configFolderpath || !fs.existsSync(configFolderpath)) {
    return index;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(configFolderpath);
  } catch {
    return index;
  }

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".xml")) {
      continue;
    }
    const fullPath = path.join(configFolderpath, entry);
    let parsed: unknown;
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      parsed = parser.parse(content);
    } catch (err) {
      console.warn(`esihelper: failed to parse ${fullPath}:`, err);
      continue;
    }
    routeFile(entry, parsed, index);
  }

  return index;
}

function routeFile(filename: string, parsed: unknown, index: XmlIndex): void {
  const lower = filename.toLowerCase();
  const root = parsed as Record<string, unknown>;
  if (lower.startsWith("messageconfig") || lower.includes("_cable")) {
    ingestMessageConfig(root, index);
  } else if (lower.includes("a429messagefields") || lower.includes("vorilsmessagefields")) {
    ingestA429MessageFields(root, index);
  } else if (lower.includes("1553messagefields") || lower.includes("milstd1553")) {
    ingestMilStd1553Fields(root, index);
  } else if (lower.includes("discretesignals")) {
    ingestDiscreteSignals(root, index);
  } else if (lower.includes("memoryports")) {
    ingestMemoryPorts(root, index);
  }
}

function ingestMessageConfig(root: Record<string, unknown>, index: XmlIndex): void {
  const r = (root.Root ?? root) as Record<string, unknown>;
  const devices = asArray((r.Devices as Record<string, unknown> | undefined)?.Device);
  for (const device of devices) {
    const d = device as Record<string, unknown>;
    const type = String(d["@_Type"] ?? "");
    const bus = BUS_PREFIX[type];
    if (!bus) {
      continue;
    }
    const conns = asArray(d.Connection);
    for (const conn of conns) {
      const c = conn as Record<string, unknown>;
      const rawName = String(c["@_Name"] ?? "");
      if (!rawName) {
        continue;
      }
      const param = c.Parameter as Record<string, unknown> | undefined;
      const { messageName, label } = parseConnectionName(rawName);
      for (const prefix of PREFIXES_BY_BUS[bus]) {
        const fullName = `${prefix}${rawName}`;
        index.connections.set(fullName, {
          fullName,
          bus,
          rawName,
          messageName,
          label,
          card: param ? str(param["@_Card"]) : undefined,
          channel: param ? str(param["@_Channel"]) : undefined,
          speed: param ? str(param["@_Speed"]) : undefined,
        });
      }
    }
  }
}

function ingestA429MessageFields(root: Record<string, unknown>, index: XmlIndex): void {
  const container =
    (root.A429Messages as Record<string, unknown> | undefined) ??
    (root.VORILSMessages as Record<string, unknown> | undefined) ??
    root;
  const messages = asArray(container.Message);
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const name = str(m.Name);
    if (!name) {
      continue;
    }
    const def: MessageDef = {
      name,
      bus: "429",
      label: numOrUndef(m.Label),
      direction: str(m.Direction),
      type: str(m.Type),
      minPeriod: numOrUndef(m.MinPeriod),
      maxPeriod: numOrUndef(m.MaxPeriod),
      fields: [],
    };
    const fields = asArray((m.Fields as Record<string, unknown> | undefined)?.Field);
    for (const f of fields) {
      def.fields.push(parseElementStyleField(f as Record<string, unknown>, name));
    }
    index.messages.set(name, def);
  }
}

function ingestMilStd1553Fields(root: Record<string, unknown>, index: XmlIndex): void {
  const container =
    (root.MilStd1553Messages as Record<string, unknown> | undefined) ?? root;
  const messages = asArray(container.Message);
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const name = str(m["@_Name"]);
    if (!name) {
      continue;
    }
    const def: MessageDef = {
      name,
      bus: "1553",
      direction: str(m["@_Direction"]),
      fields: [],
    };
    const words = asArray(m.Word);
    for (const word of words) {
      const w = word as Record<string, unknown>;
      const fields = asArray(w.Field);
      for (const f of fields) {
        def.fields.push(parseAttributeStyleField(f as Record<string, unknown>, name));
      }
    }
    index.messages.set(name, def);
  }
}

function ingestDiscreteSignals(root: Record<string, unknown>, index: XmlIndex): void {
  const container =
    (root.DiscreteMessages as Record<string, unknown> | undefined) ?? root;
  const messages = asArray(container.Message);
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const name = str(m.Name);
    if (!name) {
      continue;
    }
    const def: MessageDef = {
      name,
      bus: "Discrete",
      direction: str(m.Type),
      fields: [],
    };
    const enums = parseEnumsBlock(m.Enums);
    if (enums.length > 0) {
      def.fields.push({
        name: "Value",
        dataType: "Enum",
        size: str(m.Size),
        enums,
        parentMessage: name,
      });
    } else {
      def.fields.push({
        name: "Value",
        dataType: "UInt",
        size: str(m.Size),
        parentMessage: name,
      });
    }
    index.messages.set(name, def);
    // Discrete signals are referenced as connections under both `DIS_<name>`
    // and `DIS_<name>` (TestPit's PartitionAlias).
    for (const prefix of PREFIXES_BY_BUS["Discrete"]) {
      const fullName = `${prefix}${name}`;
      index.connections.set(fullName, {
        fullName,
        bus: "Discrete",
        rawName: name,
        messageName: name,
      });
    }
  }
}

function ingestMemoryPorts(root: Record<string, unknown>, index: XmlIndex): void {
  const container = (root.Partitions as Record<string, unknown> | undefined) ?? root;
  const partitions = asArray(container.Partition);
  for (const part of partitions) {
    const p = part as Record<string, unknown>;
    const ports = asArray(p.Port);
    for (const port of ports) {
      const portObj = port as Record<string, unknown>;
      const portName = str(portObj["@_Name"]);
      if (!portName) {
        continue;
      }
      const message = portObj.Message as Record<string, unknown> | undefined;
      const messageName = message ? str(message["@_Name"]) ?? portName : portName;
      const def: MessageDef = {
        name: messageName,
        bus: "Mem",
        fields: [],
      };
      const fields = asArray(message?.Field);
      for (const f of fields) {
        def.fields.push(parseAttributeStyleField(f as Record<string, unknown>, messageName));
      }
      index.messages.set(messageName, def);
      for (const prefix of PREFIXES_BY_BUS["Mem"]) {
        const fullName = `${prefix}${portName}`;
        index.connections.set(fullName, {
          fullName,
          bus: "Mem",
          rawName: portName,
          messageName,
        });
      }
    }
  }
}

function parseElementStyleField(
  f: Record<string, unknown>,
  parentMessage: string
): FieldDef {
  return {
    name: str(f.FieldName) ?? "",
    dataType: str(f.DataType),
    startBit: str(f.StartBit),
    size: str(f.Size),
    minValue: str(f.MinValue),
    maxValue: str(f.MaxValue),
    resolution: str(f.Resolution),
    defaultValue: str(f.DefaultValue),
    unit: str(f.Unit),
    enums: parseEnumsBlock(f.Enums),
    vc: boolOrUndef(f.VC),
    parentMessage,
  };
}

function parseAttributeStyleField(
  f: Record<string, unknown>,
  parentMessage: string
): FieldDef {
  return {
    name: str(f["@_Name"]) ?? "",
    dataType: str(f["@_DataType"]) ?? str(f["@_Type"]),
    startBit: str(f["@_StartBit"]),
    size: str(f["@_Size"]) ?? str(f["@_BitSize"]),
    minValue: str(f["@_MinValue"]),
    maxValue: str(f["@_MaxValue"]),
    resolution: str(f["@_Resolution"]),
    defaultValue: str(f["@_Default"]),
    unit: str(f["@_Unit"]),
    enums: parseEnumsBlock(f.Enums),
    parentMessage,
  };
}

function parseEnumsBlock(value: unknown): EnumDef[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const enums = asArray((value as Record<string, unknown>).Enum);
  const out: EnumDef[] = [];
  for (const e of enums) {
    const obj = e as Record<string, unknown>;
    const name = str(obj["@_Name"]);
    if (!name) {
      continue;
    }
    const text = obj["#text"];
    const numericValue = text !== undefined ? String(text) : "";
    out.push({ name, value: numericValue });
  }
  return out;
}

function parseConnectionName(rawName: string): { messageName?: string; label?: number } {
  const match = CONNECTION_NAME_PATTERN.exec(rawName);
  if (!match) {
    return { messageName: undefined, label: undefined };
  }
  return { messageName: match[2], label: Number(match[1]) };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && value !== null && "#text" in value) {
    const text = (value as Record<string, unknown>)["#text"];
    return text === undefined ? undefined : String(text);
  }
  return undefined;
}

function numOrUndef(value: unknown): number | undefined {
  const s = str(value);
  if (s === undefined || s === "") {
    return undefined;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function boolOrUndef(value: unknown): boolean | undefined {
  const s = str(value);
  if (s === undefined) {
    return undefined;
  }
  return s.toLowerCase() === "true";
}
