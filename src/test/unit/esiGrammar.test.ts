import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  RESERVED_STEP_SECTIONS,
  STEP_PREFIX,
  isKnownSectionName,
  isStepSectionName,
} from "../../lib/sectionNames";

// vscode-textmate / vscode-oniguruma are not dependencies of this repo, so the
// grammar is checked directly: every regex is compiled, screened for syntax
// Oniguruma does not share with JavaScript, and run through a small tokenizer
// below that applies TextMate's rule-selection (earliest match wins, ties go
// to the earlier pattern; begin/end regions carry over lines).

const ROOT = path.resolve(__dirname, "..", "..", "..");
const GRAMMAR_FILE = path.join(ROOT, "syntaxes", "esi.json");

interface Capture { name: string }
interface Rule {
  include?: string;
  match?: string;
  begin?: string;
  end?: string;
  name?: string;
  captures?: Record<string, Capture>;
  beginCaptures?: Record<string, Capture>;
  endCaptures?: Record<string, Capture>;
  patterns?: Rule[];
}
interface Grammar {
  scopeName: string;
  patterns: Rule[];
  repository: Record<string, Rule>;
}

const grammar = JSON.parse(fs.readFileSync(GRAMMAR_FILE, "utf-8")) as Grammar;

function allRegexes(): { where: string; source: string }[] {
  const out: { where: string; source: string }[] = [];
  for (const [key, rule] of Object.entries(grammar.repository)) {
    for (const prop of ["match", "begin", "end"] as const) {
      const source = rule[prop];
      if (source !== undefined) {
        out.push({ where: `${key}.${prop}`, source });
      }
    }
  }
  return out;
}

// ---- mini tokenizer ---------------------------------------------------------

interface Token { text: string; scopes: string[] }
interface Candidate {
  re: RegExp;
  name?: string;
  captures?: Record<string, Capture>;
  region?: Rule; // set on a `begin`
  isEnd?: boolean;
}

function resolve(patterns: Rule[]): Rule[] {
  return patterns.map((p) => {
    if (!p.include) {
      return p;
    }
    const rule = grammar.repository[p.include.replace(/^#/, "")];
    assert.ok(rule, `unresolved include ${p.include}`);
    return rule;
  });
}

function candidates(patterns: Rule[], region: Rule | undefined): Candidate[] {
  const list: Candidate[] = [];
  if (region) {
    list.push({ re: new RegExp(region.end!, "dg"), captures: region.endCaptures, isEnd: true });
  }
  for (const rule of resolve(patterns)) {
    if (rule.match !== undefined) {
      list.push({ re: new RegExp(rule.match, "dg"), name: rule.name, captures: rule.captures });
    } else if (rule.begin !== undefined) {
      list.push({ re: new RegExp(rule.begin, "dg"), captures: rule.beginCaptures, region: rule });
    }
  }
  return list;
}

/** Tokenize whole lines; returns only the tokens that carry a scope. */
function tokenize(lines: string[]): Token[][] {
  let region: Rule | undefined;
  return lines.map((line) => {
    const scopesAt: string[][] = Array.from({ length: line.length }, () => []);
    let pos = 0;
    while (pos <= line.length) {
      const list = candidates(region ? region.patterns ?? [] : grammar.patterns, region);
      let best: { m: RegExpExecArray; c: Candidate } | undefined;
      for (const c of list) {
        c.re.lastIndex = pos;
        const m = c.re.exec(line);
        if (m && (!best || m.index < best.m.index)) {
          best = { m, c };
        }
      }
      if (!best) {
        break;
      }
      const { m, c } = best;
      const regionName = region?.name;
      const enclosing = c.region?.name ?? (c.isEnd ? regionName : undefined);
      for (let i = pos; i < m.index; i++) {
        if (regionName) { scopesAt[i].push(regionName); }
      }
      for (let i = m.index; i < m.index + m[0].length; i++) {
        if (regionName && !c.isEnd) { scopesAt[i].push(regionName); }
        if (enclosing) { scopesAt[i].push(enclosing); }
        if (c.name) { scopesAt[i].push(c.name); }
      }
      const indices = (m as unknown as { indices: ([number, number] | undefined)[] }).indices;
      for (const [group, capture] of Object.entries(c.captures ?? {})) {
        const span = indices[Number(group)];
        if (span) {
          for (let i = span[0]; i < span[1]; i++) { scopesAt[i].push(capture.name); }
        }
      }
      if (c.region) { region = c.region; }
      if (c.isEnd) { region = undefined; }
      pos = m[0].length === 0 ? m.index + 1 : m.index + m[0].length;
    }
    if (region?.name) {
      for (let i = pos; i < line.length; i++) { scopesAt[i].push(region.name); }
    }
    const tokens: Token[] = [];
    for (let i = 0; i < line.length; i++) {
      const key = scopesAt[i].join(" ");
      const last = tokens[tokens.length - 1];
      if (last && last.scopes.join(" ") === key) {
        last.text += line[i];
      } else {
        tokens.push({ text: line[i], scopes: scopesAt[i] });
      }
    }
    return tokens;
  });
}

/** `text→innermost scope` for every token of one line that has a leaf scope. */
function leaf(line: string, context: string[] = []): string[] {
  const all = tokenize([...context, line]);
  return all[all.length - 1]
    .map((t) => ({ text: t.text, scope: t.scopes.filter((s) => !s.startsWith("meta.definition")).pop() }))
    .filter((t) => t.scope !== undefined && t.scope !== "meta.csv-ref.esi")
    .map((t) => `${t.text}→${t.scope!.replace(/\.esi$/, "")}`);
}

const TAG_BEGIN = "punctuation.definition.tag.begin";
const TAG_END = "punctuation.definition.tag.end";
const TAG_CLOSE = "punctuation.definition.tag.close";

describe("syntaxes/esi.json", () => {
  describe("well-formedness", () => {
    it("declares the scope package.json registers and resolves every include", () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
      assert.strictEqual(grammar.scopeName, "source.esi");
      assert.ok(
        pkg.contributes.grammars.some(
          (g: { scopeName: string; path: string }) =>
            g.scopeName === grammar.scopeName && path.resolve(ROOT, g.path) === GRAMMAR_FILE
        )
      );
      const includes = [grammar.patterns, ...Object.values(grammar.repository).map((r) => r.patterns ?? [])].flat();
      assert.ok(includes.length > 0);
      resolve(includes);
      // Every repository rule is reachable from the top level.
      const top = new Set(grammar.patterns.map((p) => p.include!.replace(/^#/, "")));
      assert.deepStrictEqual([...top].sort(), Object.keys(grammar.repository).sort());
    });

    it("every regex compiles", () => {
      for (const { where, source } of allRegexes()) {
        assert.doesNotThrow(() => new RegExp(source), where);
      }
    });

    it("every regex stays inside the syntax JavaScript and Oniguruma share", () => {
      // Things one engine has and the other lacks or reads differently.
      const forbidden: [RegExp, string][] = [
        [/\(\?<[A-Za-z_]/, "named group"],
        [/\\k</, "named back-reference"],
        [/\\[pP]\{/, "unicode property class"],
        [/\\u\{|\\u[0-9a-fA-F]{4}|\\x\{/, "code-point escape"],
        [/\\c[A-Za-z]/, "control escape"],
        [/\[\^?\]/, "empty character class"],
        [/\(\?[imsxa-]+[:)]/, "inline flag group"],
        [/\\[AzZGhHRXK]/, "Oniguruma-only anchor/escape"],
        [/\[\[:|&&/, "POSIX bracket / class intersection"],
        [/[*+?}]\+/, "possessive quantifier"],
        [/\(\?>|\(\?~|\(\?#/, "atomic / absent / comment group"],
      ];
      for (const { where, source } of allRegexes()) {
        for (const [re, what] of forbidden) {
          assert.ok(!re.test(source), `${where}: ${what} in ${source}`);
        }
        // Oniguruma look-behind must be of bounded, simple width.
        for (const m of source.matchAll(/\(\?<[=!]((?:\[[^\]]*\]|\\.|[^()[\\])*)\)/g)) {
          assert.ok(!/[*+?{|]/.test(m[1].replace(/\[[^\]]*\]/g, "c")), `${where}: variable-width look-behind ${m[0]}`);
        }
        assert.strictEqual(
          (source.match(/\(\?<[=!]/g) ?? []).length,
          [...source.matchAll(/\(\?<[=!]((?:\[[^\]]*\]|\\.|[^()[\\])*)\)/g)].length,
          `${where}: look-behind with a nested group`
        );
      }
    });

    it("every scope name ends in .esi", () => {
      const names: string[] = [];
      for (const rule of Object.values(grammar.repository)) {
        if (rule.name) { names.push(rule.name); }
        for (const caps of [rule.captures, rule.beginCaptures, rule.endCaptures]) {
          names.push(...Object.values(caps ?? {}).map((c) => c.name));
        }
      }
      assert.ok(names.length > 10);
      for (const name of names) {
        assert.match(name, /^[a-z][a-z0-9.-]*\.esi$/);
      }
    });
  });

  describe("tags", () => {
    it("separates a step tag from the structural sections and from other tags", () => {
      assert.deepStrictEqual(leaf("[STEP 10]"), [`[→${TAG_BEGIN}`, "STEP 10→entity.name.tag.step", `]→${TAG_END}`]);
      assert.deepStrictEqual(leaf("  [STEP GET_DUMP]")[1], "STEP GET_DUMP→entity.name.tag.step");
      assert.deepStrictEqual(leaf("[STEP INPUTS]")[1], "STEP INPUTS→entity.name.tag.section");
      assert.deepStrictEqual(leaf("[TEST STEPS]")[1], "TEST STEPS→entity.name.tag.section");
      assert.deepStrictEqual(leaf("[429_ILS_Course]")[1], "429_ILS_Course→entity.name.tag");
      assert.deepStrictEqual(leaf("[SOMETHING ELSE]")[1], "SOMETHING ELSE→entity.name.tag");
    });

    it("gives the closing slash and the one-liner slash their own scope", () => {
      assert.deepStrictEqual(leaf("[/STEP 10]"), [
        `[→${TAG_BEGIN}`, `/→${TAG_CLOSE}`, "STEP 10→entity.name.tag.step", `]→${TAG_END}`,
      ]);
      assert.deepStrictEqual(leaf("[/STEP OUTPUTS]").slice(1, 3), [`/→${TAG_CLOSE}`, "STEP OUTPUTS→entity.name.tag.section"]);
      assert.deepStrictEqual(leaf("[ED_Type1/]"), [
        `[→${TAG_BEGIN}`, "ED_Type1→entity.name.tag", `/→${TAG_CLOSE}`, `]→${TAG_END}`,
      ]);
      assert.deepStrictEqual(leaf("[STEP DUMP/]").slice(1, 3), ["STEP DUMP→entity.name.tag.section", `/→${TAG_CLOSE}`]);
      assert.deepStrictEqual(leaf("[STEP 5/]").slice(1, 3), ["STEP 5→entity.name.tag.step", `/→${TAG_CLOSE}`]);
    });

    it("agrees with sectionNames.ts on what is a step and what is a section", () => {
      const sectionRule = grammar.repository["section-tags"].match!;
      const listed = /\(\\\[\)\(\/\?\)\(([^)]*)\)/.exec(sectionRule)![1].split("|");
      assert.ok(listed.length > 0);
      for (const name of listed) {
        assert.ok(isKnownSectionName(name), name);
        assert.ok(!isStepSectionName(name), name);
      }
      for (const name of RESERVED_STEP_SECTIONS) {
        assert.ok(listed.includes(name), name);
        assert.strictEqual(leaf(`[${name}]`)[1], `${name}→entity.name.tag.section`);
      }
      for (const name of [`${STEP_PREFIX}1`, `${STEP_PREFIX}INPUTS_2`, `${STEP_PREFIX}DUMP A`, `${STEP_PREFIX} INPUTS`]) {
        assert.ok(isStepSectionName(name), name);
        assert.strictEqual(leaf(`[${name}]`)[1], `${name}→entity.name.tag.step`);
      }
      assert.strictEqual(leaf("[STEPS]")[1], "STEPS→entity.name.tag");
    });

    it("does not colour a tag inside a comment", () => {
      assert.deepStrictEqual(leaf("# [STEP 10] time = 10ms"), ["# [STEP 10] time = 10ms→comment.line.number-sign"]);
    });
  });

  describe("values", () => {
    it("colours a number and its unit separately, leaving plain numbers and identifiers alone", () => {
      assert.deepStrictEqual(leaf("time = 10ms"), [
        "time→keyword.other.field", "=→keyword.operator.assignment", "10→constant.numeric", "ms→keyword.other.unit",
      ]);
      assert.deepStrictEqual(leaf("x = 2.5s -3deg 400Hz").slice(2), [
        "2.5→constant.numeric", "s→keyword.other.unit", "-3→constant.numeric", "deg→keyword.other.unit",
        "400→constant.numeric", "Hz→keyword.other.unit",
      ]);
      assert.deepStrictEqual(leaf("x = 10").slice(2), ["10→constant.numeric"]);
      assert.deepStrictEqual(leaf("x = 0x1F 1e5 1.5").slice(2), [
        "0x1F→constant.numeric", "1e5→constant.numeric", "1.5→constant.numeric",
      ]);
      // Not units: an identifier, a hex-looking word, an unlisted suffix.
      assert.deepStrictEqual(leaf("x = DO-260B_11503 1F 10ms_x 3rd").slice(2), []);
    });

    it("colours the comparison operator of an occurrence count only", () => {
      assert.deepStrictEqual(leaf("    occurrence = >3"), [
        "occurrence→keyword.other.field", "=→keyword.operator.assignment",
        ">→keyword.operator.comparison", "3→constant.numeric",
      ]);
      assert.deepStrictEqual(leaf("occurrence=< 12").slice(2), ["<→keyword.operator.comparison", "12→constant.numeric"]);
      assert.deepStrictEqual(leaf("occurrence = ALL").slice(2), []);
      assert.deepStrictEqual(leaf("occurrence = 3").slice(2), ["3→constant.numeric"]);
      assert.deepStrictEqual(leaf("value = >3").slice(2), ["3→constant.numeric"]);
      assert.deepStrictEqual(leaf("occurrence = >%N%").slice(2), ["%N%→variable.other.macro"]);
    });

    it("colours <pre> / <br/> markup, and never as a path", () => {
      assert.deepStrictEqual(leaf("cond = <pre>").slice(2), ["<pre>→meta.tag.markup"]);
      assert.deepStrictEqual(leaf("    <br/> step 1"), ["<br/>→meta.tag.markup", "1→constant.numeric"]);
      assert.deepStrictEqual(leaf("<br> a <br /> b </pre>"), [
        "<br>→meta.tag.markup", "<br />→meta.tag.markup", "</pre>→meta.tag.markup",
      ]);
      assert.deepStrictEqual(leaf("x = <pre> inline </pre>").slice(2), ["<pre>→meta.tag.markup", "</pre>→meta.tag.markup"]);
    });

    it("colours the cell address of a CSV reference", () => {
      assert.deepStrictEqual(leaf("Course = data\\in.csv line:12 col:3"), [
        "Course→keyword.other.field", "=→keyword.operator.assignment", "data\\in.csv→string.other.path",
        "line→keyword.other.csv-ref", ":→punctuation.separator.csv-ref", "12→constant.numeric",
        "col→keyword.other.csv-ref", ":→punctuation.separator.csv-ref", "3→constant.numeric",
      ]);
      assert.deepStrictEqual(leaf("x = a.CSV  Line : 1  COL : 2").slice(3).filter((t) => t.includes("csv-ref")).length, 4);
      // Only directly after a .csv file.
      assert.deepStrictEqual(leaf("x = line:1 col:2").slice(2), ["1→constant.numeric", "2→constant.numeric"]);
      assert.deepStrictEqual(leaf("x = a.txt line:1 col:2").slice(3), ["1→constant.numeric", "2→constant.numeric"]);
    });

    it("keeps the pre-existing value scopes", () => {
      assert.deepStrictEqual(leaf('a = "text" %MAC% ../x/run.py dir/sub/ TRUE N/A').slice(2), [
        '"text"→string.quoted.double', "%MAC%→variable.other.macro", "../x/run.py→string.other.path",
        "dir/sub/→string.other.path", "TRUE→constant.language", "N/A→constant.language",
      ]);
      assert.deepStrictEqual(leaf("  system call = tool.exe").slice(0, 1), ["system call→keyword.other.field"]);
    });
  });

  describe("definition block", () => {
    const open = ["[STEP DEFINITION]"];

    it("scopes its own tags as structural sections, slash included", () => {
      const lines = tokenize(["[TEST DEFINITION]", "x", "[/TEST DEFINITION]", "n = 5"]);
      assert.deepStrictEqual(
        lines[0].map((t) => t.scopes[t.scopes.length - 1]),
        [`${TAG_BEGIN}.esi`, "entity.name.tag.section.esi", `${TAG_END}.esi`]
      );
      assert.deepStrictEqual(
        lines[2].map((t) => t.scopes[t.scopes.length - 1]),
        [`${TAG_BEGIN}.esi`, `${TAG_CLOSE}.esi`, "entity.name.tag.section.esi", `${TAG_END}.esi`]
      );
      // The region ends: numbers are coloured again afterwards.
      assert.ok(lines[3].some((t) => t.scopes.includes("constant.numeric.esi")));
      assert.ok(lines[1].every((t) => t.scopes.includes("meta.definition.esi")));
    });

    it("leaves prose uncoloured: numbers, units, operators, constants, paths, CSV refs, tags", () => {
      assert.deepStrictEqual(
        leaf("  Wait 10ms then check 3 items, TRUE or >5, see a/b.csv line:1 col:2 [STEP 2]", open),
        []
      );
      assert.deepStrictEqual(leaf("  Step Description = Send 5 frames at 400Hz", open), [
        "Step Description→keyword.other.field", "=→keyword.operator.assignment",
      ]);
      assert.deepStrictEqual(leaf("  occurrence = >3", open), [
        "occurrence→keyword.other.field", "=→keyword.operator.assignment",
      ]);
    });

    it("still colours comments, macros, strings and the markup", () => {
      assert.deepStrictEqual(leaf("  Step Conditions = <pre>", open).slice(2), ["<pre>→meta.tag.markup"]);
      assert.deepStrictEqual(leaf('    <br/> * use %PORT% and "quoted 7" # note 9', open), [
        "<br/>→meta.tag.markup", "%PORT%→variable.other.macro", '"quoted 7"→string.quoted.double',
        "# note 9→comment.line.number-sign",
      ]);
    });
  });
});
