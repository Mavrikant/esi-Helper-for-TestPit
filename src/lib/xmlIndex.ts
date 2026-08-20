import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";
import { ProfileConfigs } from "./testpitRegistry";

export type Bus = "429" | "1553" | "DIS" | "Mem" | "VORILS" | "ED";

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
  // ED_ — External Data (DTIF / ARINC 735B) message reference, e.g.
  // [ED_Type1]. Messages come from the EDConfigFile (EDMessageFields.xml).
  "ED",
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
  ED: ["ED_"],
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
  /** `false` where the field carries no meaning — reserved, spare or padding.
   *  TestPit keeps such a field's name but ignores any value a script gives it
   *  ("reserved or restricted"). Recorded so hover and completion can say so;
   *  never enforced here. Undefined where nothing decides it either way. */
  used?: boolean;
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
  /** Flat, keyed by bare message name — last writer wins on a cross-bus name
   *  collision. Kept for name-only lookups; use `messagesByBus` to resolve
   *  within a specific bus. */
  messages: Map<string, MessageDef>;
  /** Keyed by `messageKey(bus, name)` — collision-safe, so an A429 message and
   *  a memory-port message that share a name both survive. */
  messagesByBus: Map<string, MessageDef>;
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

/**
 * Configuration file format, stated as `Version` on the root element — the two
 * TestPit itself knows (Core/XMLConfigParser.h):
 *
 *   1 — one child ELEMENT per value:  <Message><Name>X</Name>…   (no Version means this)
 *   2 — one ATTRIBUTE per value:      <Message Name="X" …>
 *
 * Both are read by the same ingesters below. There is no second code path: every
 * value goes through `nodeValue`, which takes the attribute when the node has one
 * and the child element of the same name otherwise — which is exactly why format 2
 * kept the element names it replaced. A configuration in the field needs no change.
 */
export const XML_CONFIG_VERSION_LEGACY = 1;
export const XML_CONFIG_VERSION_LATEST = 2;

/** Which shape a file was written in. Only the discrete reader branches on it
 *  (its BitSize default differs between the two); everything else reads both. */
export function formatVersion(container: Record<string, unknown>): number {
  const stated = numOrUndef(container["@_Version"]);
  return stated !== undefined && stated >= XML_CONFIG_VERSION_LATEST
    ? XML_CONFIG_VERSION_LATEST
    : XML_CONFIG_VERSION_LEGACY;
}

/**
 * Port of `XMLConfigParser::getNodeValue` — the whole of the two-format
 * mechanism: the attribute when the node has one, the child element of the same
 * name otherwise. An empty value counts as absent, the way the engine's accessor
 * treats it (there it falls through to the caller's default).
 */
export function nodeValue(
  node: Record<string, unknown>,
  tag: string
): string | undefined {
  const attribute = node[`@_${tag}`];
  const value = attribute !== undefined ? str(attribute) : str(node[tag]);
  return value === undefined || value === "" ? undefined : value;
}

/**
 * The first of `tags` the node actually states. Only a handful of names were
 * respelled for format 2 (Name/FieldName, DataType/Type, BitSize/Size,
 * DefaultValue/Default, Encoding/Type); format 2's spelling always goes first,
 * so a converted file wins and a format 1 file falls through to its own.
 */
function anyNodeValue(
  node: Record<string, unknown>,
  ...tags: string[]
): string | undefined {
  for (const tag of tags) {
    const value = nodeValue(node, tag);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/** Port of `XMLConfigParser::isEnumDefinitionNode` — format 2 calls a set of
 *  states <EnumDef>, format 1 calls it <Enums>, and both are taken everywhere. */
const ENUM_DEFINITION_TAGS = ["EnumDef", "Enums"] as const;

/** The node the states of `node` are written in, if any. */
function enumContainer(
  node: Record<string, unknown>
): Record<string, unknown> | undefined {
  for (const tag of ENUM_DEFINITION_TAGS) {
    const wrapper = asArray<unknown>(node[tag])[0];
    if (wrapper && typeof wrapper === "object") {
      return wrapper as Record<string, unknown>;
    }
  }
  // No wrapper: the states sit straight in the node. Looked at ONLY when there
  // is no wrapper — a format 1 field carries a second <ValidEnums> block beside
  // its <Enums>, and TestPit has never read that one.
  return node.Enum !== undefined ? node : undefined;
}

/**
 * Port of `XMLConfigParser::resolveEnums` — `Ref="X"` takes the shared set of
 * states named X from the file's <Common><CommonEnums> table, no `Ref` takes the
 * states written in the node itself.
 *
 * Only ever called on a <Field>, and on a discrete <Message> (which IS its one
 * value): in the software-test configuration `Ref` spells three different things,
 * naming a shared PORT on <Port> and a shared MESSAGE on <Message>, and only on a
 * field does it name states.
 *
 * A `Ref` that resolves to nothing leaves the field with no states rather than
 * guessing — TestPit reports the dangling reference when it loads the file.
 */
function resolveEnums(
  node: Record<string, unknown>,
  commonEnums?: Map<string, EnumDef[]>
): EnumDef[] {
  const ref = nodeValue(node, "Ref");
  if (ref !== undefined) {
    return commonEnums?.get(ref) ?? [];
  }
  return parseEnumsBlock(node);
}

/**
 * Whether a field or word carries meaning, read the way TestPit reads it: the
 * file's own `Used` when it states one (format 2), and otherwise the name rule
 * the engine has always guessed with — A429 ignores anything starting Reserved,
 * Spare or Pad plus FutureSpare, 1553 ignores a word starting Spare.
 *
 * The format 1 positional label rule (the first three fields of every A429
 * message, whatever they are called) is deliberately NOT reproduced: it names a
 * field by position rather than by anything the file says, and nothing here acts
 * on the answer — it is shown, never enforced.
 */
function isNodeUsed(
  node: Record<string, unknown>,
  name: string
): boolean | undefined {
  const stated = nodeValue(node, "Used");
  if (stated !== undefined) {
    return stated.toLowerCase() === "true";
  }
  return isIgnoredName(name) ? false : undefined;
}

function isIgnoredName(name: string): boolean {
  return (
    name === "FutureSpare" ||
    name.startsWith("Reserved") ||
    name.startsWith("Spare") ||
    name.startsWith("Pad")
  );
}

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

/** Collision-safe key for `messagesByBus` — a message is identified by its
 *  bus AND name, since names can repeat across buses (e.g. an A429 message and
 *  a memory port both named "RadioAltitude"). */
export function messageKey(bus: Bus, name: string): string {
  return `${bus}:${name}`;
}

export function createEmptyIndex(): XmlIndex {
  return {
    connections: new Map(),
    messages: new Map(),
    messagesByBus: new Map(),
    resolveConnectionMessage(fullName) {
      const conn = this.connections.get(fullName);
      if (conn?.messageName) {
        // Bus-aware first: the flat `messages` map keeps only the last-ingested
        // message for a given name, so a 429_ connection could otherwise pick up
        // a same-named Mem/partition message. Resolve within the connection's bus.
        const byBus = this.messagesByBus.get(messageKey(conn.bus, conn.messageName));
        if (byBus) {
          return byBus;
        }
        const direct = this.messages.get(conn.messageName);
        if (direct) {
          return direct;
        }
      }
      // VORILS<N>_<MsgName> fallback: VORILSMessageFields registers a
      // canonical VORILS1_<MsgName> connection, but scripts may use
      // VORILS2_…, VORILS3_…, etc. for additional units. Strip the unit
      // number and look up the message (bus-aware, then by name).
      const m = VORILS_UNIT_PREFIX.exec(fullName);
      if (m) {
        return (
          this.messagesByBus.get(messageKey("VORILS", m[1])) ??
          this.messages.get(m[1])
        );
      }
      return undefined;
    },
  };
}

/** Register a message in both the flat and bus-aware maps. */
function registerMessage(index: XmlIndex, def: MessageDef): void {
  index.messages.set(def.name, def);
  index.messagesByBus.set(messageKey(def.bus, def.name), def);
}

/**
 * Build an index from a profile's resolved config paths (from the registry),
 * dispatching each file to its ingester by ROLE — not by filename. This is the
 * production entry point: NEOCAS/RNEQual/etc. use non-standard filenames
 * (A429Messages_HURJET.xml, NeoCASPorts.xml, …) that filename routing can't
 * recognise, but the registry already tells us each file's role.
 *
 * A role is parsed only when its path is set AND the file exists on disk —
 * the registry's per-role MRU can hold stale paths for buses a profile no
 * longer uses.
 */
export function parseConfigFiles(configs: ProfileConfigs): XmlIndex {
  const index = createEmptyIndex();
  const byRole: ReadonlyArray<
    readonly [keyof ProfileConfigs, (root: Record<string, unknown>, index: XmlIndex) => void]
  > = [
    ["cable", ingestMessageConfig],
    ["a429", ingestA429MessageFields],
    ["m1553", ingestMilStd1553Fields],
    ["discrete", ingestDiscreteSignals],
    ["partition", ingestMemoryPorts],
    ["vorils", ingestVORILSMessageFields],
    ["ed", ingestEDMessageFields],
  ];
  for (const [role, ingest] of byRole) {
    const file = configs[role];
    if (!file || !fs.existsSync(file)) {
      continue;
    }
    // Guard parse AND ingest per file: a malformed or unexpectedly-shaped
    // config must not break the whole index (or extension activation) — skip
    // just that file.
    try {
      const parsed = parser.parse(fs.readFileSync(file, "utf-8"));
      ingest(parsed as Record<string, unknown>, index);
    } catch (err) {
      console.warn(`esihelper: failed to load ${role} config ${file}:`, err);
    }
  }
  return index;
}

export function parseConfigFolder(configFolderpath: string): XmlIndex {
  const index = createEmptyIndex();

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
    const lower = entry.toLowerCase();
    if (!lower.endsWith(".xml")) {
      continue;
    }
    // `convert_config --replace` keeps the format 1 original beside the file it
    // converted, as <name>.v1.xml. Both are readable configurations, so folder
    // mode would ingest the superseded one as well — skip it, the way TRT's own
    // readers of these files do.
    if (lower.endsWith(".v1.xml")) {
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
  } else if (lower.includes("memoryports") || lower.includes("ports")) {
    ingestMemoryPorts(root, index);
  } else if (lower.includes("edmessagefields") || lower.includes("edmessage")) {
    ingestEDMessageFields(root, index);
  }
}

function ingestMessageConfig(root: Record<string, unknown>, index: XmlIndex): void {
  const r = (root.Root ?? root) as Record<string, unknown>;
  // NEOCAS factors the physical card/channel/speed into a <References> block
  // and points each <Connection Ref="…"> at a named <Channel>. RNE/VORILS keep
  // those attributes inline on a <Parameter>. Support both.
  const channels = collectChannels(r);
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
      const { messageName, label } = parseConnectionName(rawName);
      const ref = str(c["@_Ref"]);
      const param = c.Parameter as Record<string, unknown> | undefined;
      const referenced = ref ? channels.get(ref) : undefined;
      const card = referenced?.card ?? (param ? str(param["@_Card"]) : undefined);
      const channel = referenced?.channel ?? (param ? str(param["@_Channel"]) : undefined);
      const speed = referenced?.speed ?? (param ? str(param["@_Speed"]) : undefined);
      for (const prefix of PREFIXES_BY_BUS[bus]) {
        const fullName = `${prefix}${rawName}`;
        index.connections.set(fullName, {
          fullName,
          bus,
          rawName,
          messageName,
          label,
          card,
          channel,
          speed,
        });
      }
    }
  }
}

interface ChannelParam {
  card?: string;
  channel?: string;
  speed?: string;
}

/** Build a name → {card,channel,speed} map from a cable file's <References>. */
function collectChannels(r: Record<string, unknown>): Map<string, ChannelParam> {
  const map = new Map<string, ChannelParam>();
  const refs = r.References as Record<string, unknown> | undefined;
  if (!refs) {
    return map;
  }
  for (const device of asArray(refs.Device)) {
    const d = device as Record<string, unknown>;
    const channelsNode = d.Channels as Record<string, unknown> | undefined;
    for (const ch of asArray(channelsNode?.Channel)) {
      const c = ch as Record<string, unknown>;
      const name = str(c["@_Name"]);
      if (!name) {
        continue;
      }
      map.set(name, {
        card: str(c["@_Card"]),
        channel: str(c["@_Channel"]),
        speed: str(c["@_Speed"]),
      });
    }
  }
  return map;
}

function ingestVORILSMessageFields(root: Record<string, unknown>, index: XmlIndex): void {
  // VORILSMessageFields.xml has a different shape than A429/1553:
  //   <Messages>
  //     <InputMessages>
  //       <Message Name="..." Id="...">
  //         <Field Name="..." DataType="Enum|UInt32|DoubleDegree|..." StartBit="..." BitSize="...">
  //           <EnumDef>...</EnumDef>         # for Enum   (<Enums> in format 1)
  //           <Encoding Type="BNR" MinValue="..." MaxValue="..." Resolution="..."/>  # for numeric
  //         </Field>
  //       </Message>
  //     </InputMessages>
  //     <OutputMessages> ... </OutputMessages>
  //   </Messages>
  // This one is written by hand, so format 2 leaves its states where their
  // author put them rather than lifting them into the shared table.
  const container = (root.Messages as Record<string, unknown> | undefined) ?? root;
  const commonEnums = collectCommonEnums(container);
  for (const groupKey of ["InputMessages", "OutputMessages"]) {
    const group = container[groupKey] as Record<string, unknown> | undefined;
    if (!group) {
      continue;
    }
    const messages = asArray(group.Message);
    const direction = groupKey === "InputMessages" ? "Input" : "Output";
    for (const msg of messages) {
      const m = msg as Record<string, unknown>;
      const name = nodeValue(m, "Name");
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
        def.fields.push(
          parseVORILSField(f as Record<string, unknown>, name, commonEnums)
        );
      }
      registerMessage(index, def);
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
  parentMessage: string,
  commonEnums?: Map<string, EnumDef[]>
): FieldDef {
  const field = parseField(f, parentMessage, commonEnums);
  // Numeric-typed fields carry a nested <Encoding> with min/max/resolution.
  // It is the field's own coding, not the shared kind of Encoding A429 states
  // on a message, and it stays a child element in both formats.
  const encoding = f.Encoding as Record<string, unknown> | undefined;
  if (encoding) {
    field.minValue = nodeValue(encoding, "MinValue");
    field.maxValue = nodeValue(encoding, "MaxValue");
    field.resolution = nodeValue(encoding, "Resolution");
  }
  return field;
}

function ingestA429MessageFields(root: Record<string, unknown>, index: XmlIndex): void {
  const container =
    (root.A429Messages as Record<string, unknown> | undefined) ??
    (root.VORILSMessages as Record<string, unknown> | undefined) ??
    root;
  const commonEnums = collectCommonEnums(container);
  const messages = asArray(container.Message);
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const name = nodeValue(m, "Name");
    if (!name) {
      continue;
    }
    const def: MessageDef = {
      name,
      bus: "429",
      label: numOrUndef(nodeValue(m, "Label")),
      // Direction, MinPeriod and MaxPeriod are format 1 only — nothing in
      // TestPit ever read them, so format 2 leaves them out.
      direction: nodeValue(m, "Direction"),
      // The label's coding: BNR, BCD, Discrete or ISO5. Format 1 calls it Type,
      // which reads as if it were a field's DataType and is not; format 2 says
      // Encoding, on the message as the default and on a field as the override.
      type: anyNodeValue(m, "Encoding", "Type"),
      minPeriod: numOrUndef(nodeValue(m, "MinPeriod")),
      maxPeriod: numOrUndef(nodeValue(m, "MaxPeriod")),
      fields: [],
    };
    // Format 1 wraps the fields in <Fields>; format 2 writes <Field> straight
    // into the message.
    const wrapper = m.Fields as Record<string, unknown> | undefined;
    const fields = asArray<unknown>(wrapper ? wrapper.Field : m.Field);
    for (const f of fields) {
      def.fields.push(parseField(f as Record<string, unknown>, name, commonEnums));
    }
    registerMessage(index, def);
  }
}

function ingestMilStd1553Fields(root: Record<string, unknown>, index: XmlIndex): void {
  const container =
    (root.MilStd1553Messages as Record<string, unknown> | undefined) ?? root;
  const commonEnums = collectCommonEnums(container);
  const messages = asArray(container.Message);
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const name = nodeValue(m, "Name");
    if (!name) {
      continue;
    }
    const def: MessageDef = {
      name,
      bus: "1553",
      direction: nodeValue(m, "Direction"),
      fields: [],
    };
    // 1553 fields are nested under <Word> elements and are referenced in
    // .esi scripts with dot notation: `Mode.SelectedCourse = …` (the word
    // is `Mode`, the field is `SelectedCourse`). Qualify each parsed
    // field name with its parent word so lookups by the dotted form work.
    const words = asArray(m.Word);
    for (const word of words) {
      const w = word as Record<string, unknown>;
      const wordName = nodeValue(w, "Name");
      // On this bus it is the WORD that is marked rather than the field, and
      // TestPit drops an unused word along with every field in it. They stay in
      // the index so a script writing one is never called unknown, carrying the
      // mark so hover and completion can say the value will be ignored.
      const wordUsed = isNodeUsed(w, wordName ?? "");
      const fields = asArray(w.Field);
      for (const f of fields) {
        const field = parseField(f as Record<string, unknown>, name, commonEnums);
        if (wordUsed === false) {
          field.used = false;
        }
        if (wordName) {
          field.name = `${wordName}.${field.name}`;
        }
        def.fields.push(field);
      }
    }
    registerMessage(index, def);
  }
}

function ingestDiscreteSignals(root: Record<string, unknown>, index: XmlIndex): void {
  const container =
    (root.DiscreteMessages as Record<string, unknown> | undefined) ?? root;
  const commonEnums = collectCommonEnums(container);
  // One pin carries one bit, so format 2 leaves the width out at 1. A format 1
  // file that omits it means nothing of the kind — TestPit reads 0 there and
  // refuses the signal where a step uses it — so the default is version-gated.
  const defaultSize =
    formatVersion(container) >= XML_CONFIG_VERSION_LATEST ? "1" : undefined;
  const messages = asArray(container.Message);
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    // TestPit strips every '#' out of a discrete name, in either format
    // (DiscreteConfigType.cpp): TAStatus#1 becomes TAStatus1, which is the
    // spelling the cable file uses and the one a script writes. Format 2 files
    // are converted with the sharps already gone; a format 1 file still has
    // them, and without this the signal would be indexed under a name no
    // script can name - so its fields would silently never be checked.
    const name = nodeValue(m, "Name")?.split("#").join("");
    if (!name) {
      continue;
    }
    const def: MessageDef = {
      name,
      bus: "DIS",
      direction: nodeValue(m, "Type"),
      fields: [],
    };
    // A discrete signal IS its single value, so its states sit on the MESSAGE:
    // by Ref into the shared table, or written in the message itself.
    const enums = resolveEnums(m, commonEnums);
    const size = anyNodeValue(m, "BitSize", "Size") ?? defaultSize;
    if (enums.length > 0) {
      def.fields.push({
        name: "value",
        dataType: "Enum",
        size,
        enums,
        parentMessage: name,
      });
    } else {
      def.fields.push({
        name: "value",
        dataType: "UInt",
        size,
        parentMessage: name,
      });
    }
    registerMessage(index, def);
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
  // NEOCAS defines each port once under <Common><CommonPorts> (with field enums
  // pulled from <Common><CommonEnums> via Ref) and then has every <Partition>
  // reference them by name. RNE inlines a <Message> in each partition port.
  const commonEnums = collectCommonEnums(container);
  const commonPorts = collectCommonPorts(container, commonEnums, index);

  for (const part of asArray(container.Partition)) {
    const p = part as Record<string, unknown>;
    const partitionName = nodeValue(p, "Name");
    for (const port of asArray(p.Port)) {
      const portObj = port as Record<string, unknown>;
      const localName = nodeValue(portObj, "Name");
      if (!localName) {
        continue;
      }
      const inlineMessage = portObj.Message as Record<string, unknown> | undefined;
      // Ref on a PORT names a common port, not a set of states — in this one
      // configuration the same spelling means three different things, and only
      // on a <Field> does it name states.
      const ref = nodeValue(portObj, "Ref");

      let messageName: string;
      let bus: Bus = "Mem";
      let isInlineMem = false;

      if (inlineMessage) {
        // RNE-style: the message is defined inline on the partition's port.
        const portType = nodeValue(portObj, "Type");
        bus = (portType && PORT_TYPE_TO_BUS[portType]) || "Mem";
        // Format 2 leaves the message's Name out where it only repeated the
        // port's, which is what it did on 842 of 918 ports.
        messageName = nodeValue(inlineMessage, "Name") ?? localName;
        const def: MessageDef = { name: messageName, bus, fields: [] };
        for (const f of asArray(inlineMessage.Field)) {
          def.fields.push(parseField(f as Record<string, unknown>, messageName, commonEnums));
        }
        registerMessage(index, def);
        isInlineMem = bus === "Mem";
      } else if (ref && commonPorts.has(ref)) {
        // NEOCAS-style: <Port Name="LocalName" Ref="CommonPortName"/>.
        const common = commonPorts.get(ref)!;
        messageName = common.messageName;
        bus = common.bus;
      } else {
        // Neither inline nor resolvable — register a bare message so the PART_
        // connection still resolves (just with no fields). Guarded so it never
        // clobbers a richer same-name/same-bus message ingested elsewhere.
        messageName = localName;
        const stub: MessageDef = { name: messageName, bus, fields: [] };
        if (!index.messages.has(messageName)) {
          index.messages.set(messageName, stub);
        }
        const stubKey = messageKey(bus, messageName);
        if (!index.messagesByBus.has(stubKey)) {
          index.messagesByBus.set(stubKey, stub);
        }
      }

      // PART_<partition>_<localName> — the canonical fully-qualified form used
      // in scripts. The local name can differ from (and reuse) the referenced
      // common port name (e.g. IOHealthState_Alert → IOHealthState).
      if (partitionName) {
        const partFullName = `PART_${partitionName}_${localName}`;
        index.connections.set(partFullName, {
          fullName: partFullName,
          bus,
          rawName: localName,
          messageName,
        });
      }

      // RNE Memory-typed inline ports are also referenced via the short Mem_
      // prefix. (A429/1553/Discrete connections come from the cable file; the
      // NEOCAS Sampling/Queuing ports are referenced only via PART_.)
      if (isInlineMem) {
        for (const prefix of PREFIXES_BY_BUS["Mem"]) {
          const fullName = `${prefix}${localName}`;
          index.connections.set(fullName, {
            fullName,
            bus: "Mem",
            rawName: localName,
            messageName,
          });
        }
      }
    }
  }
}

/**
 * Port of `XMLConfigParser::parseCommonEnums` — the sets of states a whole file
 * shares, from <Common><CommonEnums> under its root, which any field then takes
 * by `Ref="<name>"`. External data and the software test configuration have been
 * written this way for years; format 2 gives the other four buses the same table
 * rather than repeating a set of states once per field that uses it.
 */
function collectCommonEnums(container: Record<string, unknown>): Map<string, EnumDef[]> {
  const map = new Map<string, EnumDef[]>();
  const common = container.Common as Record<string, unknown> | undefined;
  const commonEnums = common?.CommonEnums as Record<string, unknown> | undefined;
  if (!commonEnums) {
    return map;
  }
  for (const tag of ENUM_DEFINITION_TAGS) {
    for (const group of asArray<unknown>(commonEnums[tag])) {
      const g = group as Record<string, unknown>;
      const name = str(g["@_Name"]);
      // A repeated name is refused by TestPit rather than silently shadowed;
      // keep the first here so the index matches what it would have loaded.
      if (name && !map.has(name)) {
        map.set(name, parseEnumsBlock(g));
      }
    }
  }
  return map;
}

/**
 * Parse <Common><CommonPorts> into MessageDefs (registered in the index) and
 * return a port-name → {messageName,bus} map so partition references resolve.
 */
function collectCommonPorts(
  container: Record<string, unknown>,
  commonEnums: Map<string, EnumDef[]>,
  index: XmlIndex
): Map<string, { messageName: string; bus: Bus }> {
  const map = new Map<string, { messageName: string; bus: Bus }>();
  const common = container.Common as Record<string, unknown> | undefined;
  const commonPorts = common?.CommonPorts as Record<string, unknown> | undefined;
  if (!commonPorts) {
    return map;
  }
  for (const port of asArray(commonPorts.Port)) {
    const portObj = port as Record<string, unknown>;
    const portName = nodeValue(portObj, "Name");
    if (!portName) {
      continue;
    }
    const portType = nodeValue(portObj, "Type");
    const bus: Bus = (portType && PORT_TYPE_TO_BUS[portType]) || "Mem";
    const message = portObj.Message as Record<string, unknown> | undefined;
    const messageName = (message ? nodeValue(message, "Name") : undefined) ?? portName;
    const def: MessageDef = { name: messageName, bus, fields: [] };
    for (const f of asArray(message?.Field)) {
      def.fields.push(parseField(f as Record<string, unknown>, messageName, commonEnums));
    }
    registerMessage(index, def);
    map.set(portName, { messageName, bus });
  }
  return map;
}

/**
 * EDMessageFields.xml (External Data / DTIF, ARINC 735B). Shape:
 *   <EDRoot><Common><CommonEnums>…</CommonEnums></Common>
 *           <Messages><Message Name="TypeN">
 *             <Field Name="…" DataType="Enum" Ref="DisplayMatrix"/> …
 *           </Message></Messages></EDRoot>
 * Messages are referenced in scripts as [ED_<MessageName>] (e.g. [ED_Type1]).
 *
 * Format 1 calls the root <Root>, which the cable file also uses; format 2 says
 * <EDRoot>. No reader has ever tested a root tag — they all go straight for its
 * children — so both spellings are taken here.
 */
function ingestEDMessageFields(root: Record<string, unknown>, index: XmlIndex): void {
  const container =
    (root.EDRoot as Record<string, unknown> | undefined) ??
    (root.Root as Record<string, unknown> | undefined) ??
    root;
  const commonEnums = collectCommonEnums(container);
  const messagesNode = container.Messages as Record<string, unknown> | undefined;
  if (!messagesNode) {
    return;
  }
  for (const msg of asArray(messagesNode.Message)) {
    const m = msg as Record<string, unknown>;
    const name = nodeValue(m, "Name");
    if (!name) {
      continue;
    }
    const def: MessageDef = { name, bus: "ED", fields: [] };
    for (const f of asArray(m.Field)) {
      def.fields.push(parseField(f as Record<string, unknown>, name, commonEnums));
    }
    registerMessage(index, def);
    for (const prefix of PREFIXES_BY_BUS["ED"]) {
      const fullName = `${prefix}${name}`;
      index.connections.set(fullName, {
        fullName,
        bus: "ED",
        rawName: name,
        messageName: name,
      });
    }
  }
}

/**
 * The one field reader, for every bus and both formats. `nodeValue` takes an
 * attribute or a child element of the same name, so the only per-format
 * knowledge left is the handful of names format 2 actually respelled — and each
 * of those takes both spellings, the newer one first.
 */
export function parseField(
  f: Record<string, unknown>,
  parentMessage: string,
  commonEnums?: Map<string, EnumDef[]>
): FieldDef {
  // Name everywhere in format 2, the way 1553, external data, VOR/ILS and the
  // software test configuration always spelled it; A429 format 1 says FieldName.
  const name = anyNodeValue(f, "Name", "FieldName") ?? "";
  return {
    name,
    // The field's data type. VOR/ILS, external data and the software test
    // configuration called it Type in format 1, which is a word that means five
    // different things across these files; DataType means only this one.
    dataType: anyNodeValue(f, "DataType", "Type"),
    startBit: nodeValue(f, "StartBit"),
    // A width in BITS. A429 and 1553 called it Size, which is a width in BYTES
    // on a message elsewhere; BitSize is what the other configurations say.
    size: anyNodeValue(f, "BitSize", "Size"),
    minValue: nodeValue(f, "MinValue"),
    maxValue: nodeValue(f, "MaxValue"),
    resolution: nodeValue(f, "Resolution"),
    // 1553 format 1 says Default and TestPit did not encode it — it put zero on
    // the bus for a field a script left out. Format 2 says DefaultValue on every
    // bus and encodes it, which is why the reader is gated on the SPELLING.
    defaultValue: anyNodeValue(f, "DefaultValue", "Default"),
    // Unit and VC are format 1 only; nothing in TestPit reads either.
    unit: nodeValue(f, "Unit"),
    enums: resolveEnums(f, commonEnums),
    vc: boolOrUndef(nodeValue(f, "VC")),
    used: isNodeUsed(f, name),
    parentMessage,
  };
}

/**
 * The states a node declares, in any of the three shapes TestPit accepts:
 * wrapped in <EnumDef> (format 2), wrapped in <Enums> (format 1), or written
 * straight into the node with no wrapper at all. All three are read in either
 * format — the engine is deliberately unfussy about a thing it understands.
 */
export function parseEnumsBlock(value: unknown): EnumDef[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const container = enumContainer(value as Record<string, unknown>);
  if (!container) {
    return [];
  }
  const enums = asArray<unknown>(container.Enum);
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
