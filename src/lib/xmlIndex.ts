import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";

export type Bus = "429" | "1553" | "DIS" | "Mem" | "VORILS";

/**
 * Single source of truth for bus prefixes used in `.esi` `[NAME]` references.
 *
 * `.esi` scripts reference:
 *   - Discrete signals under `DIS_` (TestPit's PartitionAlias for the
 *     `Discrete` partition — the alias is in MemoryPorts.xml).
 *   - VORILS messages under `VORILS<N>_` where N is the unit number
 *     (e.g. `VORILS1_VORILSDataMsg`). The canonical prefix exposed by
 *     completion is `VORILS1_`, but resolveConnectionMessage strips
 *     any unit number when looking up the underlying message.
 *
 * The XML attribute `<Device Type="Discrete">` is mapped to internal
 * Bus "DIS" via BUS_PREFIX below.
 */
export const COMPONENT_TAG_PREFIXES = [
  "429",
  "1553",
  "DIS",
  "Mem",
  "VORILS\\d+",
  // PART_<PartitionName>_ — fully-qualified memory-port reference
  // (e.g. PART_HSI_RNEGeneralWritePSAlive, PART_TEST_MBPBITStatus).
  // Partitions in MemoryPorts.xml: HSI, DD, TEST, A429, M1553, Discrete,
  // DMETACAN. The trailing `_` between partition and port is matched by
  // the `_` at the end of COMPONENT_TAG_PATTERN.
  "PART_[A-Za-z][A-Za-z0-9]*",
] as const;

export const COMPONENT_TAG_PATTERN = new RegExp(
  `^(${COMPONENT_TAG_PREFIXES.join("|")})_`
);

/** Matches a `VORILS<N>_` prefix; capture group 1 = the rest of the name. */
export const VORILS_UNIT_PREFIX = /^VORILS\d+_(.+)$/;

const PREFIXES_BY_BUS: Record<Bus, string[]> = {
  "429": ["429_"],
  "1553": ["1553_"],
  "DIS": ["DIS_"],
  Mem: ["Mem_"],
  // Canonical: connections are registered under VORILS1_. Other unit
  // numbers (VORILS2_, etc.) are accepted via the resolveConnectionMessage
  // fallback that strips the unit number.
  VORILS: ["VORILS1_"],
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

/**
 * True if `name` is a recognised connection in the index. Handles the
 * VORILS<N>_ unit-number suffix as a special case — only VORILS1 is
 * registered as a canonical connection, but other unit numbers
 * resolve to the same underlying message.
 */
export function isKnownComponent(index: XmlIndex, name: string): boolean {
  if (index.connections.has(name)) {
    return true;
  }
  const m = VORILS_UNIT_PREFIX.exec(name);
  if (m) {
    return index.messages.has(m[1]);
  }
  return false;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

const CONNECTION_NAME_PATTERN = /^L(\d+)([A-Z][A-Za-z0-9]*?)(?:_\w+)?$/;
// Maps the `<Device Type="...">` XML attribute on MessageConfig devices to
// our internal `Bus` value. Note that the XML attribute is "Discrete" but
// scripts use the "DIS" prefix — internally we use "DIS" everywhere.
const BUS_PREFIX: Record<string, Bus> = {
  A429: "429",
  "1553": "1553",
  Discrete: "DIS",
  Memory: "Mem",
};

export function parseConfigFolder(configFolderpath: string): XmlIndex {
  const index: XmlIndex = {
    connections: new Map(),
    messages: new Map(),
    resolveConnectionMessage(fullName) {
      const conn = this.connections.get(fullName);
      if (conn?.messageName) {
        const direct = this.messages.get(conn.messageName);
        if (direct) {
          return direct;
        }
      }
      // VORILS<N>_<MsgName> fallback: VORILSMessageFields registers a
      // canonical VORILS1_<MsgName> connection, but scripts may use
      // VORILS2_…, VORILS3_…, etc. for additional units. Strip the unit
      // number and look up the message directly.
      const m = VORILS_UNIT_PREFIX.exec(fullName);
      if (m) {
        return this.messages.get(m[1]);
      }
      return undefined;
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
  } else if (lower.includes("vorilsmessagefields")) {
    ingestVORILSMessageFields(root, index);
  } else if (lower.includes("a429messagefields")) {
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

function ingestVORILSMessageFields(root: Record<string, unknown>, index: XmlIndex): void {
  // VORILSMessageFields.xml has a different shape than A429/1553:
  //   <Messages>
  //     <InputMessages>
  //       <Message Name="..." Id="..." Size="...">
  //         <Field Name="..." Type="Enum|UInt32|DoubleDegree|..." StartBit="..." BitSize="...">
  //           <Enums>...</Enums>             # for Enum
  //           <Encoding Type="BNR" MinValue="..." MaxValue="..." Resolution="..."/>  # for numeric
  //         </Field>
  //       </Message>
  //     </InputMessages>
  //     <OutputMessages> ... </OutputMessages>
  //   </Messages>
  const container = (root.Messages as Record<string, unknown> | undefined) ?? root;
  for (const groupKey of ["InputMessages", "OutputMessages"]) {
    const group = container[groupKey] as Record<string, unknown> | undefined;
    if (!group) {
      continue;
    }
    const messages = asArray(group.Message);
    const direction = groupKey === "InputMessages" ? "Input" : "Output";
    for (const msg of messages) {
      const m = msg as Record<string, unknown>;
      const name = str(m["@_Name"]);
      if (!name) {
        continue;
      }
      const def: MessageDef = {
        name,
        bus: "VORILS",
        direction,
        fields: [],
      };
      const fields = asArray(m.Field);
      for (const f of fields) {
        def.fields.push(parseVORILSField(f as Record<string, unknown>, name));
      }
      index.messages.set(name, def);
      // Synthesize a canonical VORILS1_<MessageName> connection so completion
      // suggests it. Other unit numbers (VORILS2, VORILS3, …) are accepted
      // via the resolveConnectionMessage / isKnownComponent fallback that
      // strips the unit-number prefix.
      for (const prefix of PREFIXES_BY_BUS["VORILS"]) {
        const fullName = `${prefix}${name}`;
        index.connections.set(fullName, {
          fullName,
          bus: "VORILS",
          rawName: name,
          messageName: name,
        });
      }
    }
  }
}

function parseVORILSField(
  f: Record<string, unknown>,
  parentMessage: string
): FieldDef {
  const field: FieldDef = {
    name: str(f["@_Name"]) ?? "",
    dataType: str(f["@_Type"]),
    startBit: str(f["@_StartBit"]),
    size: str(f["@_BitSize"]),
    enums: parseEnumsBlock(f.Enums),
    parentMessage,
  };
  // Numeric-typed fields carry a nested <Encoding> with min/max/resolution.
  const encoding = f.Encoding as Record<string, unknown> | undefined;
  if (encoding) {
    field.minValue = str(encoding["@_MinValue"]);
    field.maxValue = str(encoding["@_MaxValue"]);
    field.resolution = str(encoding["@_Resolution"]);
  }
  return field;
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
    // 1553 fields are nested under <Word> elements and are referenced in
    // .esi scripts with dot notation: `Mode.SelectedCourse = …` (the word
    // is `Mode`, the field is `SelectedCourse`). Qualify each parsed
    // field name with its parent word so lookups by the dotted form work.
    const words = asArray(m.Word);
    for (const word of words) {
      const w = word as Record<string, unknown>;
      const wordName = str(w["@_Name"]);
      const fields = asArray(w.Field);
      for (const f of fields) {
        const field = parseAttributeStyleField(f as Record<string, unknown>, name);
        if (wordName) {
          field.name = `${wordName}.${field.name}`;
        }
        def.fields.push(field);
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
      bus: "DIS",
      direction: str(m.Type),
      fields: [],
    };
    const enums = parseEnumsBlock(m.Enums);
    if (enums.length > 0) {
      def.fields.push({
        name: "value",
        dataType: "Enum",
        size: str(m.Size),
        enums,
        parentMessage: name,
      });
    } else {
      def.fields.push({
        name: "value",
        dataType: "UInt",
        size: str(m.Size),
        parentMessage: name,
      });
    }
    index.messages.set(name, def);
    // Discrete signals are referenced as connections under DIS_<name>
    // (TestPit's PartitionAlias for the Discrete partition).
    for (const prefix of PREFIXES_BY_BUS["DIS"]) {
      const fullName = `${prefix}${name}`;
      index.connections.set(fullName, {
        fullName,
        bus: "DIS",
        rawName: name,
        messageName: name,
      });
    }
  }
}

// Maps a `<Port Type="…">` XML attribute to our internal Bus value.
// MemoryPorts.xml lumps every partition's ports into one file; the port's
// Type attribute is what tells us which bus it belongs to.
const PORT_TYPE_TO_BUS: Record<string, Bus> = {
  Memory: "Mem",
  IndexMemory: "Mem",
  A429Sim: "429",
  M1553Sim: "1553",
  DiscreteSim: "DIS",
  // Catch-all (PulseDataInjector, ServerWakeUpMessage, DMETACANPBIT, …)
  // gets bucketed as Mem since they're partition-scoped, not bus-scoped.
};

function ingestMemoryPorts(root: Record<string, unknown>, index: XmlIndex): void {
  const container = (root.Partitions as Record<string, unknown> | undefined) ?? root;
  const partitions = asArray(container.Partition);
  for (const part of partitions) {
    const p = part as Record<string, unknown>;
    const partitionName = str(p["@_Name"]);
    const ports = asArray(p.Port);
    for (const port of ports) {
      const portObj = port as Record<string, unknown>;
      const portName = str(portObj["@_Name"]);
      if (!portName) {
        continue;
      }
      const portType = str(portObj["@_Type"]);
      const bus: Bus =
        (portType && PORT_TYPE_TO_BUS[portType]) || "Mem";
      const message = portObj.Message as Record<string, unknown> | undefined;
      const messageName = message ? str(message["@_Name"]) ?? portName : portName;
      const def: MessageDef = {
        name: messageName,
        bus,
        fields: [],
      };
      const fields = asArray(message?.Field);
      for (const f of fields) {
        def.fields.push(parseAttributeStyleField(f as Record<string, unknown>, messageName));
      }
      index.messages.set(messageName, def);

      // PART_<partitionName>_<portName> — the canonical fully-qualified
      // form used in scripts (e.g. PART_HSI_VORILSMBReadBITResult,
      // PART_TEST_MBPBITStatus). Always registered when we have a partition
      // name, regardless of port type.
      if (partitionName) {
        const partFullName = `PART_${partitionName}_${portName}`;
        index.connections.set(partFullName, {
          fullName: partFullName,
          bus,
          rawName: portName,
          messageName,
        });
      }

      // Also register the bus's short prefix for Memory-typed ports
      // (Mem_<portName>). For A429/M1553/Discrete-typed ports, the
      // canonical bus-prefixed connection comes from MessageConfig.xml's
      // <Connection> elements, so we don't double-register here.
      if (bus === "Mem") {
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
}

export function parseElementStyleField(
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

export function parseAttributeStyleField(
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

export function parseEnumsBlock(value: unknown): EnumDef[] {
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

export function parseConnectionName(rawName: string): { messageName?: string; label?: number } {
  // 429 connections follow `L<label><MessageName>(_<suffix>)?` (e.g.
  // `L100SelectedCourseBNR_input1` → message `SelectedCourseBNR`, label 100).
  // 1553 / Memory connections use the bare name directly (the connection
  // name IS the message name — e.g. `TACANDMEOutput1`, `ADFCommand`,
  // `RNEGeneralWriteLedStatus`). When the L-pattern doesn't match, fall
  // back to the raw name so resolveConnectionMessage can still find the
  // matching MessageDef.
  const match = CONNECTION_NAME_PATTERN.exec(rawName);
  if (match) {
    return { messageName: match[2], label: Number(match[1]) };
  }
  return { messageName: rawName, label: undefined };
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function str(value: unknown): string | undefined {
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

export function numOrUndef(value: unknown): number | undefined {
  const s = str(value);
  if (s === undefined || s === "") {
    return undefined;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function boolOrUndef(value: unknown): boolean | undefined {
  const s = str(value);
  if (s === undefined) {
    return undefined;
  }
  return s.toLowerCase() === "true";
}
