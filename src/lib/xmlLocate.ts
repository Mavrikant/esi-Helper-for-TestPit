import * as fs from "fs";
import { pathToFileURL } from "url";
import { findConnectionByBareName } from "./bareConnectionLookup";
import { resolveContext } from "./esiContext";
import {
  BUS_PREFIX,
  Bus,
  COMPONENT_TAG_PATTERN,
  ConnectionDef,
  FieldDef,
  MessageDef,
  PORT_TYPE_TO_BUS,
  XmlIndex,
} from "./xmlIndex";

/**
 * Go to Definition from a `.esi` component / field / enum value into the
 * TestPit config XML it was indexed from.
 *
 * The index (lib/xmlIndex.ts) is built with fast-xml-parser, which keeps no
 * source positions, so it records only WHICH FILE a connection or message came
 * from. The position inside that file is found here, lazily, when somebody
 * actually asks: a small position-keeping scan of the file's text, then a walk
 * to the defining element using the same shapes the ingesters read —
 *
 *   - both config formats: a value as an ATTRIBUTE (`<Message Name="X">`,
 *     format 2) or as a CHILD ELEMENT (`<Message><Name>X</Name>`, format 1);
 *   - the `Ref` forms: a partition `<Port Ref>` lands on the shared port's
 *     message under `<Common><CommonPorts>`, and an enum value of a field (or
 *     discrete message) with `Ref` lands on the entry in
 *     `<Common><CommonEnums>`.
 *
 * Nothing here decides what is valid — it only finds where something the index
 * already holds is written. When the element cannot be pinpointed the nearest
 * enclosing thing is returned (`exact: false`), down to the top of the file.
 *
 * Everything but `loadXmlTree` is pure.
 */

// ───────────────────────── position-keeping XML scan ─────────────────────────

export interface XmlAttr {
  name: string;
  value: string;
  /** Offset of the first character of the value (inside the quotes). */
  valueStart: number;
  /** Length of the value as written (before entity decoding). */
  rawLength: number;
}

export interface XmlNode {
  tag: string;
  /** Offset of the element's `<`. */
  start: number;
  attrs: XmlAttr[];
  children: XmlNode[];
  parent?: XmlNode;
  /** Direct text content, trimmed and entity-decoded. */
  text: string;
  /** Offset of the first non-whitespace text character, when there is text. */
  textStart?: number;
}

export interface XmlTree {
  root: XmlNode;
  /** Offset of the first character of each line. */
  lineStarts: number[];
}

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
};

function decode(raw: string): string {
  return raw.includes("&")
    ? raw.replace(/&(?:lt|gt|amp|quot|apos);/g, (e) => ENTITIES[e])
    : raw;
}

const WHITESPACE = /\s/;

/**
 * Scan XML text into a light element tree that remembers offsets. Deliberately
 * forgiving: comments, CDATA, processing instructions and DOCTYPE are skipped,
 * and malformed input ends the scan with whatever was read so far rather than
 * throwing — the worst outcome is a less precise jump.
 */
export function scanXml(source: string): XmlTree {
  // VS Code hides a byte-order mark; keep columns on line 0 in step with it.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }
  const root: XmlNode = { tag: "", start: 0, attrs: [], children: [], text: "" };
  let current = root;
  let i = 0;
  const n = text.length;

  const addText = (from: number, to: number): void => {
    if (current === root) {
      return;
    }
    let a = from;
    while (a < to && WHITESPACE.test(text[a])) {
      a++;
    }
    if (a >= to) {
      return;
    }
    let b = to;
    while (b > a && WHITESPACE.test(text[b - 1])) {
      b--;
    }
    if (current.textStart === undefined) {
      current.textStart = a;
    }
    current.text += decode(text.slice(a, b));
  };

  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt === -1) {
      addText(i, n);
      break;
    }
    addText(i, lt);
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end === -1) {
        break;
      }
      i = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end === -1) {
        break;
      }
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      if (end === -1) {
        break;
      }
      i = end + 2;
      continue;
    }
    if (text.startsWith("<!", lt)) {
      const end = text.indexOf(">", lt + 2);
      if (end === -1) {
        break;
      }
      i = end + 1;
      continue;
    }
    if (text.startsWith("</", lt)) {
      const end = text.indexOf(">", lt + 2);
      if (end === -1) {
        break;
      }
      const name = text.slice(lt + 2, end).trim();
      // Close the nearest open element of that name; a stray close tag that
      // matches nothing is ignored.
      for (let node: XmlNode | undefined = current; node && node !== root; node = node.parent) {
        if (node.tag === name) {
          current = node.parent ?? root;
          break;
        }
      }
      i = end + 1;
      continue;
    }

    // An opening (or self-closing) tag.
    let p = lt + 1;
    while (p < n && !WHITESPACE.test(text[p]) && text[p] !== ">" && text[p] !== "/") {
      p++;
    }
    const node: XmlNode = {
      tag: text.slice(lt + 1, p),
      start: lt,
      attrs: [],
      children: [],
      parent: current,
      text: "",
    };
    let selfClosing = false;
    let closed = false;
    while (p < n) {
      while (p < n && WHITESPACE.test(text[p])) {
        p++;
      }
      if (p >= n) {
        break;
      }
      if (text[p] === ">") {
        p++;
        closed = true;
        break;
      }
      if (text[p] === "/") {
        selfClosing = true;
        p++;
        continue;
      }
      const nameStart = p;
      while (p < n && !WHITESPACE.test(text[p]) && text[p] !== "=" && text[p] !== ">" && text[p] !== "/") {
        p++;
      }
      const attrName = text.slice(nameStart, p);
      while (p < n && WHITESPACE.test(text[p])) {
        p++;
      }
      if (text[p] !== "=") {
        continue; // valueless attribute — not XML, but keep going
      }
      p++;
      while (p < n && WHITESPACE.test(text[p])) {
        p++;
      }
      const quote = text[p];
      if (quote !== '"' && quote !== "'") {
        continue;
      }
      const valueEnd = text.indexOf(quote, p + 1);
      if (valueEnd === -1) {
        p = n;
        break;
      }
      node.attrs.push({
        name: attrName,
        value: decode(text.slice(p + 1, valueEnd)),
        valueStart: p + 1,
        rawLength: valueEnd - p - 1,
      });
      p = valueEnd + 1;
    }
    if (!closed) {
      break;
    }
    current.children.push(node);
    if (!selfClosing) {
      current = node;
    }
    i = p;
  }
  return { root, lineStarts };
}

// ───────────────────────────── node helpers ─────────────────────────────

interface Span {
  offset: number;
  length: number;
}

function attr(node: XmlNode, name: string): XmlAttr | undefined {
  return node.attrs.find((a) => a.name === name);
}

function child(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

function childrenOf(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c) => c.tag === tag);
}

function descendants(node: XmlNode, tag: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.tag === tag) {
      out.push(c);
    }
    descendants(c, tag, out);
  }
  return out;
}

/**
 * A value with where it is written — the attribute when the node has one, the
 * child element of the same name otherwise, and an empty value counts as
 * absent. Mirrors `nodeValue` in xmlIndex.ts.
 */
function valueOf(
  node: XmlNode,
  ...tags: string[]
): { value: string; span: Span } | undefined {
  for (const tag of tags) {
    const a = attr(node, tag);
    if (a) {
      if (a.value !== "") {
        return { value: a.value, span: { offset: a.valueStart, length: a.rawLength } };
      }
      continue;
    }
    const c = child(node, tag);
    if (c && c.text !== "" && c.textStart !== undefined) {
      return { value: c.text, span: { offset: c.textStart, length: c.text.length } };
    }
  }
  return undefined;
}

/** Name everywhere in format 2; A429 format 1 fields say FieldName. */
function nameOf(node: XmlNode): { value: string; span: Span } | undefined {
  return valueOf(node, "Name", "FieldName");
}

/** Where to put the cursor for a node: on its name when it states one, on its
 *  tag otherwise. */
function spanOf(node: XmlNode): Span {
  return nameOf(node)?.span ?? { offset: node.start + 1, length: node.tag.length };
}

// ───────────────────────────── targets ─────────────────────────────

/**
 * What to find. `conn` on the message / field / enum forms is the connection
 * the script named, when there is one in the index: for a `PART_<partition>_
 * <port>` reference it selects THAT partition's port (inline message, or the
 * shared port it refers to) instead of the first message of that name.
 */
export type DefinitionTarget =
  | { kind: "connection"; conn: ConnectionDef }
  | { kind: "message"; message: MessageDef; conn?: ConnectionDef }
  | { kind: "field"; message: MessageDef; field: FieldDef; conn?: ConnectionDef }
  | {
      kind: "enum";
      message: MessageDef;
      field: FieldDef;
      enumName: string;
      conn?: ConnectionDef;
    };

export interface XmlPosition {
  /** 0-based line. */
  line: number;
  /** 0-based column (UTF-16 units, as VS Code counts). */
  character: number;
  /** Length of the name at that position (0 for the top-of-file fallback). */
  length: number;
  /** False when the exact element was not found and this is the nearest
   *  enclosing one (or the top of the file). */
  exact: boolean;
}

export interface XmlLocation extends XmlPosition {
  file: string;
  kind: DefinitionTarget["kind"];
}

const TOP_OF_FILE: XmlPosition = { line: 0, character: 0, length: 0, exact: false };

function toPosition(tree: XmlTree, span: Span, exact: boolean): XmlPosition {
  const starts = tree.lineStarts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= span.offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return {
    line: lo,
    character: span.offset - starts[lo],
    length: span.length,
    exact,
  };
}

/** The config file a target is defined in, as recorded by the index. */
export function sourceFileOf(target: DefinitionTarget): string | undefined {
  return target.kind === "connection"
    ? target.conn.sourceFile
    : target.message.sourceFile;
}

// ───────────────────────────── finders ─────────────────────────────

/** `<Partition Name=partition>` → `<Port Name=port>`. */
function findPartitionPort(
  tree: XmlTree,
  partition: string,
  port: string
): XmlNode | undefined {
  for (const part of descendants(tree.root, "Partition")) {
    if (nameOf(part)?.value !== partition) {
      continue;
    }
    const found = childrenOf(part, "Port").find((p) => nameOf(p)?.value === port);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** `<Common><CommonPorts><Port Name=name>`. */
function findCommonPort(tree: XmlTree, name: string): XmlNode | undefined {
  for (const table of descendants(tree.root, "CommonPorts")) {
    const found = childrenOf(table, "Port").find((p) => nameOf(p)?.value === name);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findConnectionNode(tree: XmlTree, conn: ConnectionDef): XmlNode | undefined {
  if (conn.partition) {
    return findPartitionPort(tree, conn.partition, conn.rawName);
  }
  // A cable-file <Connection>. Prefer the one under the <Device Type> of the
  // connection's own bus — the same raw name may be cabled on two buses.
  const named = descendants(tree.root, "Connection").filter(
    (c) => attr(c, "Name")?.value === conn.rawName
  );
  return (
    named.find((c) => {
      const type = c.parent ? attr(c.parent, "Type")?.value : undefined;
      return type !== undefined && BUS_PREFIX[type] === conn.bus;
    }) ?? named[0]
  );
}

/** The name a `<Message>` goes by: its own, or — where format 2 leaves it out
 *  because it only repeated the port's — the enclosing `<Port>`'s. */
function messageNodeName(node: XmlNode, bus: Bus): string | undefined {
  const own = nameOf(node)?.value;
  if (own !== undefined) {
    // TestPit strips every '#' out of a discrete name (see ingestDiscreteSignals).
    return bus === "DIS" ? own.split("#").join("") : own;
  }
  return node.parent?.tag === "Port" ? nameOf(node.parent)?.value : undefined;
}

/** The bus a `<Message>` inside a `<Port>` is indexed under, undefined when it
 *  is not in a port (so the file's role, not the node, decides). */
function portBus(node: XmlNode): Bus | undefined {
  if (node.parent?.tag !== "Port") {
    return undefined;
  }
  const type = valueOf(node.parent, "Type")?.value;
  return (type !== undefined && PORT_TYPE_TO_BUS[type]) || "Mem";
}

function findMessageNode(
  tree: XmlTree,
  message: MessageDef,
  conn?: ConnectionDef
): XmlNode | undefined {
  // Through the port the script named, when it is in this same file.
  if (conn?.partition && conn.sourceFile === message.sourceFile) {
    const port = findPartitionPort(tree, conn.partition, conn.rawName);
    if (port) {
      const inline = child(port, "Message");
      if (inline) {
        return inline;
      }
      const ref = valueOf(port, "Ref")?.value;
      const common = ref !== undefined ? findCommonPort(tree, ref) : undefined;
      if (common) {
        return child(common, "Message") ?? common;
      }
      return port;
    }
  }
  const named = descendants(tree.root, "Message").filter(
    (m) => messageNodeName(m, message.bus) === message.name
  );
  if (named.length > 0) {
    const sameBus = named.filter((m) => {
      const bus = portBus(m);
      return bus === undefined || bus === message.bus;
    });
    // The index keeps the last message registered under a name; so does this.
    const pool = sameBus.length > 0 ? sameBus : named;
    return pool[pool.length - 1];
  }
  // A port with no <Message> at all still registers a (field-less) message.
  return descendants(tree.root, "Port").find(
    (p) => nameOf(p)?.value === message.name
  );
}

function findFieldNode(
  messageNode: XmlNode,
  message: MessageDef,
  field: FieldDef
): XmlNode | undefined {
  const byName = (scope: XmlNode, name: string): XmlNode | undefined =>
    descendants(scope, "Field").find((f) => nameOf(f)?.value === name);
  // 1553 fields are indexed as `<Word>.<Field>`.
  const dot = field.name.indexOf(".");
  if (message.bus === "1553" && dot > 0) {
    const wordName = field.name.slice(0, dot);
    const word = descendants(messageNode, "Word").find(
      (w) => nameOf(w)?.value === wordName
    );
    const inWord = word ? byName(word, field.name.slice(dot + 1)) : undefined;
    if (inWord) {
      return inWord;
    }
  }
  return byName(messageNode, field.name);
}

const ENUM_DEFINITION_TAGS = ["EnumDef", "Enums"] as const;

/** The `<Enum Name=enumName>` among the states `owner` declares or refers to,
 *  or failing that the set of states itself. */
function findEnumNode(
  tree: XmlTree,
  owner: XmlNode,
  enumName: string
): { node: XmlNode; exact: boolean } | undefined {
  let container: XmlNode | undefined;
  const ref = valueOf(owner, "Ref")?.value;
  if (ref !== undefined) {
    // Ref="X" takes the shared set named X from <Common><CommonEnums>; the
    // first of a repeated name, as the index does.
    for (const table of descendants(tree.root, "CommonEnums")) {
      container = table.children.find(
        (c) =>
          (ENUM_DEFINITION_TAGS as readonly string[]).includes(c.tag) &&
          attr(c, "Name")?.value === ref
      );
      if (container) {
        break;
      }
    }
  } else {
    for (const tag of ENUM_DEFINITION_TAGS) {
      container = child(owner, tag);
      if (container) {
        break;
      }
    }
    container ??= owner;
  }
  if (!container) {
    return undefined;
  }
  const entry = childrenOf(container, "Enum").find(
    (e) => attr(e, "Name")?.value === enumName
  );
  if (entry) {
    return { node: entry, exact: true };
  }
  return container === owner ? undefined : { node: container, exact: false };
}

/**
 * Find `target` in a scanned config file. Always answers: the exact element
 * when it can be pinpointed, otherwise the nearest enclosing definition, and
 * the top of the file as the last resort (`exact: false` for both).
 */
export function locateInTree(tree: XmlTree, target: DefinitionTarget): XmlPosition {
  if (target.kind === "connection") {
    const node = findConnectionNode(tree, target.conn);
    if (node) {
      return toPosition(tree, spanOf(node), true);
    }
    // A connection synthesized from a message (DIS_, VORILS<N>_, ED_) is
    // defined by that message.
    const name = target.conn.messageName ?? target.conn.rawName;
    const stand: MessageDef = {
      name,
      bus: target.conn.bus,
      fields: [],
      sourceFile: target.conn.sourceFile,
    };
    const messageNode = findMessageNode(tree, stand);
    return messageNode ? toPosition(tree, spanOf(messageNode), true) : TOP_OF_FILE;
  }

  const messageNode = findMessageNode(tree, target.message, target.conn);
  if (!messageNode) {
    return TOP_OF_FILE;
  }
  // A <Message> that leaves its Name to the port is best shown at the port.
  const messageSpan =
    nameOf(messageNode) === undefined && messageNode.parent?.tag === "Port"
      ? spanOf(messageNode.parent)
      : spanOf(messageNode);
  if (target.kind === "message") {
    return toPosition(tree, messageSpan, true);
  }

  const fieldNode = findFieldNode(messageNode, target.message, target.field);
  // A discrete signal IS its single value: the index synthesizes a `value`
  // field for it, and the message is where that value is defined.
  const synthesized =
    !fieldNode && target.message.bus === "DIS" && target.field.name === "value";
  const owner = fieldNode ?? (synthesized ? messageNode : undefined);
  if (!owner) {
    return toPosition(tree, messageSpan, false);
  }
  const ownerSpan = fieldNode ? spanOf(fieldNode) : messageSpan;
  if (target.kind === "field") {
    return toPosition(tree, ownerSpan, true);
  }

  const found = findEnumNode(tree, owner, target.enumName);
  if (!found) {
    return toPosition(tree, ownerSpan, false);
  }
  const nameAttr = attr(found.node, "Name");
  const span: Span = nameAttr
    ? { offset: nameAttr.valueStart, length: nameAttr.rawLength }
    : spanOf(found.node);
  return toPosition(tree, span, found.exact);
}

/** `locateInTree` over raw file text. */
export function locateInXml(xmlText: string, target: DefinitionTarget): XmlPosition {
  return locateInTree(scanXml(xmlText), target);
}

// ───────────────────────── `.esi` side: what is under the cursor ─────────────────────────

const WORD_RE = /[A-Za-z0-9_.]+/g;

export interface EsiDefinitionQuery {
  /** The word under the cursor and where it is, for the origin range. */
  word: string;
  line: number;
  startCol: number;
  endCol: number;
  targets: DefinitionTarget[];
}

/**
 * Work out what the word under the cursor refers to, the way the hover does:
 * a field name or enum value inside a component block, otherwise a component
 * name (fully prefixed, a `VORILS<N>_` unit form, or bare).
 *
 * A component name answers with BOTH its connection and its message — in a
 * cable-driven setup they are in different files. Returns undefined when the
 * word is nothing the index knows, or is part of a `%macro%`.
 */
export function findDefinitionTargets(
  index: XmlIndex,
  documentText: string,
  lineIndex: number,
  character: number
): EsiDefinitionQuery | undefined {
  const lines = documentText.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return undefined;
  }
  const line = lines[lineIndex];
  let word: string | undefined;
  let startCol = 0;
  let endCol = 0;
  WORD_RE.lastIndex = 0;
  for (let m = WORD_RE.exec(line); m !== null; m = WORD_RE.exec(line)) {
    if (m.index <= character && character <= m.index + m[0].length) {
      word = m[0];
      startCol = m.index;
      endCol = m.index + m[0].length;
      break;
    }
  }
  if (word === undefined) {
    return undefined;
  }
  // A %macro% is the macro providers' business; its value is not known here.
  if (line[startCol - 1] === "%" || line[endCol] === "%") {
    return undefined;
  }
  const done = (targets: DefinitionTarget[]): EsiDefinitionQuery => ({
    word: word as string,
    line: lineIndex,
    startCol,
    endCol,
    targets,
  });

  // 1. Field name / enum value, resolved against the enclosing component block.
  const ctx = resolveContext(documentText, lineIndex, character);
  if (ctx.kind === "fieldName" || ctx.kind === "fieldValue") {
    const message = index.resolveConnectionMessage(ctx.messageName);
    const conn = index.connections.get(ctx.messageName);
    if (message) {
      if (ctx.kind === "fieldName") {
        const field = message.fields.find((f) => f.name === word);
        if (field) {
          return done([{ kind: "field", message, field, conn }]);
        }
      } else {
        const hasEnum = (f: FieldDef): boolean =>
          f.enums?.some((e) => e.name === word) === true;
        let field = message.fields.find((f) => f.name === ctx.fieldName);
        if (!field) {
          // The key is not a field of this message (a parameter, say). Only
          // answer when the value names a state of exactly one field.
          const owners = message.fields.filter(hasEnum);
          field = owners.length === 1 ? owners[0] : undefined;
        }
        if (field && hasEnum(field)) {
          return done([{ kind: "enum", message, field, enumName: word, conn }]);
        }
      }
    }
  }

  // 2. Component name.
  let conn = index.connections.get(word);
  let message: MessageDef | undefined;
  if (conn) {
    message = index.resolveConnectionMessage(conn.fullName);
  } else if (COMPONENT_TAG_PATTERN.test(word)) {
    // Forms not registered as canonical (VORILS2_…): no connection, a message.
    message = index.resolveConnectionMessage(word);
  } else {
    conn = findConnectionByBareName(index.connections, word);
    message = conn ? index.resolveConnectionMessage(conn.fullName) : undefined;
  }
  const targets: DefinitionTarget[] = [];
  if (conn) {
    targets.push({ kind: "connection", conn });
  }
  if (message) {
    targets.push({ kind: "message", message, conn });
  }
  return targets.length > 0 ? done(targets) : undefined;
}

// ───────────────────────── file access + resolution ─────────────────────────

export type XmlTreeLoader = (file: string) => XmlTree | undefined;

const TREE_CACHE_LIMIT = 8;
const treeCache = new Map<string, { mtimeMs: number; size: number; tree: XmlTree }>();

/**
 * Read and scan a config file, remembering the result until the file changes
 * on disk (mtime + size) — a hover card asking for a link must not re-scan a
 * multi-megabyte config on every mouse move. Undefined when it cannot be read.
 */
export function loadXmlTree(file: string): XmlTree | undefined {
  try {
    const stat = fs.statSync(file);
    const hit = treeCache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      return hit.tree;
    }
    const tree = scanXml(fs.readFileSync(file, "utf-8"));
    treeCache.delete(file);
    if (treeCache.size >= TREE_CACHE_LIMIT) {
      const oldest = treeCache.keys().next().value;
      if (oldest !== undefined) {
        treeCache.delete(oldest);
      }
    }
    treeCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, tree });
    return tree;
  } catch {
    return undefined;
  }
}

/**
 * Where one target is defined: undefined when the index recorded no file for
 * it or the file cannot be read; otherwise always a location (see
 * `locateInTree` for the fallbacks).
 */
export function resolveDefinition(
  target: DefinitionTarget,
  load: XmlTreeLoader = loadXmlTree
): XmlLocation | undefined {
  const file = sourceFileOf(target);
  if (!file) {
    return undefined;
  }
  const tree = load(file);
  if (!tree) {
    return undefined;
  }
  return { file, kind: target.kind, ...locateInTree(tree, target) };
}

/** Every distinct place the targets are defined, in target order. */
export function resolveDefinitions(
  targets: readonly DefinitionTarget[],
  load: XmlTreeLoader = loadXmlTree
): XmlLocation[] {
  const out: XmlLocation[] = [];
  for (const target of targets) {
    const loc = resolveDefinition(target, load);
    if (
      loc &&
      !out.some(
        (o) => o.file === loc.file && o.line === loc.line && o.character === loc.character
      )
    ) {
      out.push(loc);
    }
  }
  return out;
}

// ───────────────────────── "Open definition" link for hover cards ─────────────────────────

/**
 * A `file:` URI that opens `loc.file` at the definition — the `#L<line>,<col>`
 * fragment (1-based) is the form VS Code's link opener understands.
 */
export function definitionUri(loc: XmlLocation): string {
  // Parentheses are legal in a URI but end a markdown link target.
  const base = pathToFileURL(loc.file)
    .toString()
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
  return `${base}#L${loc.line + 1},${loc.character + 1}`;
}

/**
 * Markdown for an "Open definition" link to where `target` is defined, or
 * undefined when it has no known definition. For hover cards: append the
 * result to the card's MarkdownString (a plain `file:` link, so the card needs
 * no `isTrusted`).
 */
export function definitionLinkMarkdown(
  target: DefinitionTarget,
  label = "Open definition",
  load: XmlTreeLoader = loadXmlTree
): string | undefined {
  const loc = resolveDefinition(target, load);
  return loc ? `[${label}](${definitionUri(loc)})` : undefined;
}
