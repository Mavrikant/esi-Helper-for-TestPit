import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CSV_TAIL_SNIPPET,
  csvFileEntries,
  csvTailEntry,
  csvValueContext,
  listCsvFiles,
} from "../../lib/csvValueCompletion";
import { parseCsvCellRef } from "../../lib/fileRefs";

/** Context at the `|` marker of a line. */
function ctx(marked: string): ReturnType<typeof csvValueContext> {
  const character = marked.indexOf("|");
  assert.notStrictEqual(character, -1, "test needs a | marker");
  return csvValueContext(marked.slice(0, character) + marked.slice(character + 1), character);
}

describe("csvValueCompletion", () => {
  describe("csvValueContext", () => {
    it("offers files right after the =, replacing what is typed of the name", () => {
      assert.deepStrictEqual(ctx("    SDI = |"), { kind: "file", dirPart: "", startCol: 10, endCol: 10 });
      assert.deepStrictEqual(ctx("    SDI =|"), { kind: "file", dirPart: "", startCol: 9, endCol: 9 });
      assert.deepStrictEqual(ctx("    SDI = inp|"), { kind: "file", dirPart: "", startCol: 10, endCol: 13 });
      assert.deepStrictEqual(ctx("    SDI = data.c|"), { kind: "file", dirPart: "", startCol: 10, endCol: 16 });
    });

    it("splits off a folder typed so far", () => {
      assert.deepStrictEqual(ctx("SDI = ..\\data\\in|"), {
        kind: "file",
        dirPart: "..\\data\\",
        startCol: 14,
        endCol: 16,
      });
      assert.deepStrictEqual(ctx("SDI = sub/|"), { kind: "file", dirPart: "sub/", startCol: 10, endCol: 10 });
    });

    it("offers the tail once a .csv name is followed by a blank", () => {
      assert.deepStrictEqual(ctx("SDI = in.csv |"), { kind: "tail", startCol: 13, endCol: 13 });
      assert.deepStrictEqual(ctx("SDI = In.CSV  li|"), { kind: "tail", startCol: 14, endCol: 16 });
    });

    it("replaces a whole file name when retyping it, and keeps an address after it", () => {
      assert.deepStrictEqual(ctx("    SDI = ne|.csv line:4 col:2"), {
        kind: "file",
        dirPart: "",
        startCol: 10,
        endCol: 16,
        hasTail: true,
      });
      assert.deepStrictEqual(ctx("    SDI = |old.csv line:4 col:2"), {
        kind: "file",
        dirPart: "",
        startCol: 10,
        endCol: 17,
        hasTail: true,
      });
      assert.deepStrictEqual(ctx("    SDI = ne|w"), { kind: "file", dirPart: "", startCol: 10, endCol: 13 });
      // …and then only the name is inserted.
      assert.strictEqual(csvFileEntries(["new.csv"], { withTail: false })[0].insertText, "new.csv");
    });

    it("completes only the word of a tail whose numbers are already there", () => {
      assert.deepStrictEqual(ctx("SDI = in.csv li|:4 col:2"), { kind: "tail", startCol: 13, endCol: 15, hasAddress: true });
      assert.deepStrictEqual(ctx("SDI = in.csv li|ne:4 col:2"), { kind: "tail", startCol: 13, endCol: 17, hasAddress: true });
      assert.strictEqual(csvTailEntry({ withNumbers: false }).insertText, "line");
    });

    it("keeps a word that cannot be `line`, and puts only line:N before a col:M already there", () => {
      // The column was typed first: the line part goes in front of it.
      assert.deepStrictEqual(ctx("    type_code = data.csv |col:2"), {
        kind: "tail",
        startCol: 25,
        endCol: 25,
        colFollows: true,
      });
      assert.deepStrictEqual(ctx("SDI = in.csv l| col:2"), { kind: "tail", startCol: 13, endCol: 15, colFollows: true });
      assert.deepStrictEqual(ctx("SDI = in.csv li|ne col:2"), { kind: "tail", startCol: 13, endCol: 18, colFollows: true });
      // Any other word after the cursor is not replaced.
      assert.deepStrictEqual(ctx("SDI = in.csv |foo"), { kind: "tail", startCol: 13, endCol: 13 });
      const apply = (marked: string): string => {
        const c = ctx(marked);
        assert.ok(c && c.kind === "tail");
        const at = marked.indexOf("|");
        const text = marked.slice(0, at) + marked.slice(at + 1);
        const insert = csvTailEntry({ withNumbers: !c.hasAddress, beforeCol: c.colFollows })
          .insertText.replace(/\$\{\d+:([^}]*)\}/g, "$1");
        return text.slice(0, c.startCol) + insert + text.slice(c.endCol);
      };
      assert.strictEqual(apply("    type_code = data.csv |col:2"), "    type_code = data.csv line:1 col:2");
      assert.strictEqual(apply("SDI = in.csv l| col:2"), "SDI = in.csv line:1 col:2");
      assert.strictEqual(apply("SDI = in.csv li|ne:4 col:2"), "SDI = in.csv line:4 col:2");
      assert.strictEqual(apply("SDI = in.csv |"), "SDI = in.csv line:1 col:1");
      assert.ok(parseCsvCellRef(apply("    type_code = data.csv |col:2").split("= ")[1]));
    });

    it("stays out of anything that cannot start a CSV reference", () => {
      assert.strictEqual(ctx("SDI |"), undefined); // no '=' yet
      assert.strictEqual(ctx("SDI = %MAC|"), undefined); // macro
      assert.strictEqual(ctx("SDI = %DIR%\\in.csv |"), undefined);
      assert.strictEqual(ctx("SDI = 1 # in.csv |"), undefined); // comment
      assert.strictEqual(ctx("SDI = two words|"), undefined);
      assert.strictEqual(ctx("SDI = in.csv line:1 |"), undefined); // tail already there
      assert.strictEqual(ctx("SDI = in.csv line:|"), undefined);
    });
  });

  describe("entries", () => {
    it("inserts a reference the validator's own grammar reads", () => {
      const [entry] = csvFileEntries(["inputs.csv"]);
      assert.strictEqual(entry.insertText, "inputs.csv line:${1:1} col:${2:1}");
      assert.strictEqual(entry.filterText, "inputs.csv");
      const typed = entry.insertText.replace(/\$\{\d+:([^}]*)\}/g, "$1");
      assert.deepStrictEqual(parseCsvCellRef(typed), {
        file: "inputs.csv",
        line: 1,
        col: 1,
        length: typed.length,
      });
      const tail = "x.csv " + csvTailEntry().insertText.replace(/\$\{\d+:([^}]*)\}/g, "$1");
      assert.ok(parseCsvCellRef(tail));
      assert.strictEqual(csvTailEntry().insertText, CSV_TAIL_SNIPPET);
    });

    it("keeps the given order, ranks last and escapes snippet characters", () => {
      const entries = csvFileEntries(["b.csv", "a$}.csv"]);
      assert.deepStrictEqual(entries.map((e) => e.label), ["b.csv", "a$}.csv"]);
      assert.ok(entries[0].sortText < entries[1].sortText);
      assert.ok(entries.every((e) => e.sortText.startsWith("9")));
      assert.ok(entries[1].insertText.startsWith("a\\$\\}.csv "));
    });
  });

  describe("listCsvFiles", () => {
    it("lists the .csv files of a folder, sorted, files only", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "esi-csv-"));
      try {
        fs.writeFileSync(path.join(dir, "b.csv"), "");
        fs.writeFileSync(path.join(dir, "A.CSV"), "");
        fs.writeFileSync(path.join(dir, "script.esi"), "");
        fs.mkdirSync(path.join(dir, "folder.csv"));
        assert.deepStrictEqual(listCsvFiles(dir), ["A.CSV", "b.csv"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("offers only names the CSV-reference parser reads back", () => {
      const names = ["A.CSV", "a(1).csv", "çıktı.csv", "data.csv", "my data.csv", "x$y.csv", "sub-1_b.v2.csv"];
      const fake = (): { name: string; isFile(): boolean }[] =>
        names.map((name) => ({ name, isFile: () => true }));
      const listed = listCsvFiles("x", fake);
      assert.deepStrictEqual(listed, ["A.CSV", "data.csv", "sub-1_b.v2.csv"]);
      for (const entry of csvFileEntries(listed)) {
        // Expand the snippet: unescape, tab stops → their defaults.
        const inserted = entry.insertText
          .replace(/\$\{\d+:(\d+)\}/g, "$1")
          .replace(/\\([\\$}])/g, "$1");
        assert.strictEqual(parseCsvCellRef(inserted)?.file, entry.label, inserted);
      }
    });

    it("has none for a folder that cannot be read, and honours the cap", () => {
      assert.deepStrictEqual(listCsvFiles(path.join(os.tmpdir(), "esi-no-such-folder-x")), []);
      const fake = (): { name: string; isFile(): boolean }[] =>
        ["c.csv", "a.csv", "b.csv"].map((name) => ({ name, isFile: () => true }));
      assert.deepStrictEqual(listCsvFiles("x", fake, 2), ["a.csv", "b.csv"]);
    });
  });
});
