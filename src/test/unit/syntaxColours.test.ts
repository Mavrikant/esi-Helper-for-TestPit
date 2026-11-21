import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
} from "../../lib/semanticTokens";

// Guards the colour defaults in package.json `contributes.configurationDefaults`:
// nothing is switched on outside `.esi`, every coloured scope exists in the
// grammar, the light palette covers everything the dark one does, and every
// light colour meets WCAG AA (4.5:1) on each built-in light editor background.

const ROOT = path.resolve(__dirname, "..", "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const grammarText = fs.readFileSync(path.join(ROOT, "syntaxes", "esi.json"), "utf-8");
const defaults = pkg.contributes.configurationDefaults as Record<string, any>;

interface TextMateRule { scope: string; settings: { foreground?: string; fontStyle?: string } }
type SemanticRule = string | { foreground?: string; italic?: boolean; strikethrough?: boolean };

const TEXTMATE = defaults["editor.tokenColorCustomizations"] as Record<string, any>;
const SEMANTIC = defaults["editor.semanticTokenColorCustomizations"] as Record<string, any>;

// `editor.background` of each built-in light theme (VS Code's
// extensions/theme-defaults, theme-quietlight, theme-solarized-light). Both the
// current ids and the pre-rename "Default …" ids are listed.
const LIGHT_BACKGROUNDS: Record<string, string> = {
  "Light 2026": "#FFFFFF",
  "Light Modern": "#FFFFFF",
  "Default Light Modern": "#FFFFFF",
  "Light+": "#FFFFFF",
  "Default Light+": "#FFFFFF",
  "Visual Studio Light": "#FFFFFF",
  "Default High Contrast Light": "#FFFFFF",
  "Quiet Light": "#F5F5F5",
  "Solarized Light": "#FDF6E3",
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function themeKeys(section: Record<string, any>): string[] {
  return Object.keys(section).filter((k) => k.startsWith("["));
}

/** Theme names of a `[A][B]…` key — the form VS Code's themeScopeRegex splits. */
function themesOf(key: string): string[] {
  assert.match(key, /^\[[^\]]*(\]\s*\[[^\]]*)*\]$/);
  return [...key.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
}

function foregroundOf(rule: SemanticRule): string | undefined {
  return typeof rule === "string" ? rule : rule.foreground;
}

describe("syntax colour defaults (package.json)", () => {
  it("switches semantic highlighting on for esi only", () => {
    assert.ok(!("editor.semanticHighlighting.enabled" in defaults));
    assert.strictEqual(defaults["[esi]"]["editor.semanticHighlighting.enabled"], true);
    // `enabled` here would force semantic highlighting for every language.
    assert.ok(!("enabled" in SEMANTIC));
    for (const key of themeKeys(SEMANTIC)) {
      assert.ok(!("enabled" in SEMANTIC[key]));
    }
  });

  it("only touches esi scopes and esi semantic tokens", () => {
    const blocks = [TEXTMATE, ...themeKeys(TEXTMATE).map((k) => TEXTMATE[k])];
    for (const block of blocks) {
      assert.deepStrictEqual(Object.keys(block).filter((k) => !k.startsWith("[")), ["textMateRules"]);
      for (const rule of block.textMateRules as TextMateRule[]) {
        assert.match(rule.scope, /\.esi$/);
        assert.ok(
          rule.scope === "source.esi" || grammarText.includes(`"${rule.scope}"`),
          `${rule.scope} is not a scope of syntaxes/esi.json`
        );
      }
    }
    for (const block of [SEMANTIC, ...themeKeys(SEMANTIC).map((k) => SEMANTIC[k])]) {
      for (const selector of Object.keys(block.rules)) {
        const m = /^([A-Za-z*]+)((?:\.[A-Za-z]+)*):esi$/.exec(selector);
        assert.ok(m, selector);
        assert.ok(m![1] === "*" || (SEMANTIC_TOKEN_TYPES as readonly string[]).includes(m![1]), selector);
        for (const modifier of m![2].split(".").filter(Boolean)) {
          assert.ok((SEMANTIC_TOKEN_MODIFIERS as readonly string[]).includes(modifier), selector);
        }
      }
    }
  });

  it("keeps the dark colours users already had", () => {
    const dark = new Map(
      (TEXTMATE.textMateRules as TextMateRule[]).map((r) => [r.scope, r.settings.foreground])
    );
    const expected: Record<string, string> = {
      "source.esi": "#CCCCCC",
      "comment.line.number-sign.esi": "#6A9955",
      "entity.name.tag.esi": "#4BC8AF",
      "keyword.other.field.esi": "#569CD6",
      "variable.other.macro.esi": "#E5C07B",
      "string.other.path.esi": "#D2B1FA",
      "string.quoted.double.esi": "#D8A0AE",
      "constant.language.esi": "#66FFFF",
      "constant.numeric.esi": "#66FFFF",
    };
    for (const [scope, colour] of Object.entries(expected)) {
      assert.strictEqual(dark.get(scope), colour, scope);
    }
    const semantic: Record<string, string> = {
      "class:esi": "#4BC8AF",
      "property:esi": "#FA8072",
      "enumMember:esi": "#F0E04A",
      "keyword:esi": "#569CD6",
    };
    for (const [selector, colour] of Object.entries(semantic)) {
      assert.strictEqual(foregroundOf(SEMANTIC.rules[selector]), colour, selector);
    }
  });

  it("gives the new elements their own colour rule", () => {
    const scopes = (TEXTMATE.textMateRules as TextMateRule[]).map((r) => r.scope);
    for (const scope of [
      "entity.name.tag.step.esi",
      "entity.name.tag.section.esi",
      "punctuation.definition.tag.close.esi",
      "keyword.other.unit.esi",
      "keyword.operator.comparison.esi",
      "meta.tag.markup.esi",
      "keyword.other.csv-ref.esi",
    ]) {
      assert.ok(scopes.includes(scope), scope);
    }
    assert.strictEqual(new Set(scopes).size, scopes.length, "duplicate scope rule");
  });

  it("strikes through reserved fields and sets unknown names in italics", () => {
    for (const block of [SEMANTIC, ...themeKeys(SEMANTIC).map((k) => SEMANTIC[k])]) {
      assert.deepStrictEqual(block.rules["*.deprecated:esi"], { strikethrough: true });
      for (const type of ["class", "property", "enumMember"]) {
        const unknown = block.rules[`${type}:esi`];
        const known = block.rules[`${type}.defaultLibrary:esi`];
        assert.strictEqual(unknown.italic, true, type);
        assert.strictEqual(known.italic, false, type);
        assert.strictEqual(known.foreground, unknown.foreground, type);
      }
    }
  });

  it("scopes the light palette to the built-in light themes, with the same key in both settings", () => {
    assert.deepStrictEqual(themeKeys(TEXTMATE), themeKeys(SEMANTIC));
    assert.strictEqual(themeKeys(TEXTMATE).length, 1);
    const themes = themesOf(themeKeys(TEXTMATE)[0]);
    assert.deepStrictEqual([...themes].sort(), Object.keys(LIGHT_BACKGROUNDS).sort());
    // Exact names only — a wildcard such as [*Light*] would also hit dark
    // themes that merely have "Light" in their name.
    assert.ok(themes.every((t) => !t.includes("*")));
  });

  it("covers in the light palette every rule the dark palette has", () => {
    const key = themeKeys(TEXTMATE)[0];
    const scopes = (rules: TextMateRule[]) => rules.map((r) => r.scope);
    assert.deepStrictEqual(scopes(TEXTMATE[key].textMateRules), scopes(TEXTMATE.textMateRules));
    assert.deepStrictEqual(Object.keys(SEMANTIC[key].rules), Object.keys(SEMANTIC.rules));
    const style = (rules: TextMateRule[]) => rules.map((r) => r.settings.fontStyle);
    assert.deepStrictEqual(style(TEXTMATE[key].textMateRules), style(TEXTMATE.textMateRules));
  });

  it("meets WCAG AA (4.5:1) for every light colour on every built-in light background", () => {
    const key = themeKeys(TEXTMATE)[0];
    const colours: [string, string][] = [
      ...(TEXTMATE[key].textMateRules as TextMateRule[]).map(
        (r): [string, string] => [r.scope, r.settings.foreground!]
      ),
      ...Object.entries(SEMANTIC[key].rules as Record<string, SemanticRule>)
        .map(([selector, rule]): [string, string | undefined] => [selector, foregroundOf(rule)])
        .filter((e): e is [string, string] => e[1] !== undefined),
    ];
    assert.ok(colours.length >= 20);
    for (const [name, colour] of colours) {
      assert.match(colour, /^#[0-9A-F]{6}$/, name);
      for (const [theme, background] of Object.entries(LIGHT_BACKGROUNDS)) {
        const ratio = contrast(colour, background);
        assert.ok(ratio >= 4.5, `${name} ${colour} on ${theme} ${background}: ${ratio.toFixed(2)}`);
      }
    }
  });

  it("computes contrast the WCAG way", () => {
    assert.strictEqual(contrast("#000000", "#FFFFFF"), 21);
    assert.ok(Math.abs(contrast("#767676", "#FFFFFF") - 4.54) < 0.01);
  });
});
