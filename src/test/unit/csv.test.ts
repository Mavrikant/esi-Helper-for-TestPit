import * as assert from "assert";
import * as path from "path";
import {
  createCsvCellLookup,
  lookupCsvCell,
  parseCsv,
  parseCsvTable,
  renderCsvCellMarkdown,
} from "../../lib/csv";

describe("csv", () => {
  describe("parseCsv", () => {
    it("reads a simple file exactly like the old comma split", () => {
      assert.deepStrictEqual(parseCsv("a,b,c\n1, 2 ,3"), [
        ["a", "b", "c"],
        ["1", "2", "3"],
      ]);
    });

    it("handles CRLF and a trailing line break", () => {
      assert.deepStrictEqual(parseCsv("a,b\r\n1,2\r\n"), [
        ["a", "b"],
        ["1", "2"],
      ]);
    });

    it("drops a UTF-8 BOM", () => {
      assert.deepStrictEqual(parseCsv("\uFEFFname,val\nx,1"), [
        ["name", "val"],
        ["x", "1"],
      ]);
    });

    it("keeps commas inside a quoted field", () => {
      assert.deepStrictEqual(parseCsv('a,"b,c",d'), [["a", "b,c", "d"]]);
    });

    it("unescapes doubled quotes", () => {
      assert.deepStrictEqual(parseCsv('"say ""hi""",x'), [['say "hi"', "x"]]);
    });

    it("keeps a line break inside a quoted field", () => {
      const t = parseCsvTable('h1,h2\n"two\r\nlines",b\nc,d');
      assert.deepStrictEqual(
        t.rows.map((r) => r.map((c) => c.text)),
        [
          ["h1", "h2"],
          ["two\r\nlines", "b"],
          ["c", "d"],
        ]
      );
      assert.strictEqual(t.firstMultilineRow, 2);
    });

    it("does not trim inside quotes, but ignores blanks around them", () => {
      assert.deepStrictEqual(parseCsv('x, " a " ,y'), [["x", " a ", "y"]]);
    });

    it("keeps empty fields and blank lines (line numbers stay physical)", () => {
      assert.deepStrictEqual(parseCsv("a,,c\n\nd,"), [["a", "", "c"], [""], ["d", ""]]);
    });

    it("takes an unterminated quote literally instead of swallowing the file", () => {
      assert.deepStrictEqual(parseCsv('"abc,1\nx,2'), [
        ['"abc', "1"],
        ["x", "2"],
      ]);
    });

    it("takes text after a closing quote literally", () => {
      assert.deepStrictEqual(parseCsv('"a"b,c'), [['"a"b', "c"]]);
    });

    it("returns no rows for empty text", () => {
      assert.deepStrictEqual(parseCsv(""), []);
    });

    it("records where each cell starts", () => {
      const t = parseCsvTable('a, bb,"c"\r\nd,"e\nf",g');
      assert.deepStrictEqual(
        t.rows[0].map((c) => [c.line, c.character]),
        [
          [0, 0],
          [0, 3],
          [0, 6],
        ]
      );
      assert.deepStrictEqual(
        t.rows[1].map((c) => [c.line, c.character]),
        [
          [1, 0],
          [1, 2],
          [2, 3],
        ]
      );
    });
  });

  describe("lookupCsvCell", () => {
    const table = parseCsvTable("name,course\nA,10\nB,20,extra");

    it("returns the cell with its row and first-row context", () => {
      const r = lookupCsvCell(table, 3, 2);
      assert.strictEqual(r.status, "ok");
      if (r.status === "ok") {
        assert.strictEqual(r.value, "20");
        assert.strictEqual(r.firstRowValue, "course");
        assert.deepStrictEqual(r.row, ["B", "20", "extra"]);
        assert.strictEqual(r.fileLine, 2);
        assert.strictEqual(r.fileCharacter, 2);
      }
    });

    it("distinguishes a missing file, row and column", () => {
      assert.deepStrictEqual(lookupCsvCell(undefined, 1, 1), { status: "fileMissing" });
      assert.deepStrictEqual(lookupCsvCell(table, 9, 1), { status: "rowMissing", rowCount: 3 });
      assert.deepStrictEqual(lookupCsvCell(table, 0, 1), { status: "rowMissing", rowCount: 3 });
      assert.deepStrictEqual(lookupCsvCell(table, 2, 3), { status: "colMissing", colCount: 2 });
      assert.deepStrictEqual(lookupCsvCell(table, 2, 0), { status: "colMissing", colCount: 2 });
    });

    it("refuses to guess at or after a multi-line record", () => {
      const t = parseCsvTable('a,b\n"x\ny",c\nd,e');
      assert.strictEqual(lookupCsvCell(t, 1, 1).status, "ok");
      assert.strictEqual(lookupCsvCell(t, 2, 1).status, "ambiguous");
      assert.strictEqual(lookupCsvCell(t, 3, 1).status, "ambiguous");
    });
  });

  describe("createCsvCellLookup", () => {
    const script = path.resolve("/proj/tests/a.esi");

    it("resolves relative to the script folder and reads each file once", () => {
      const reads: string[] = [];
      const lookup = createCsvCellLookup(script, (p) => {
        reads.push(p);
        return 'k,v\n"a,b",2';
      });
      const r = lookup("data.csv", 2, 1);
      assert.strictEqual(r.status === "ok" && r.value, "a,b");
      lookup("data.csv", 2, 2);
      assert.deepStrictEqual(reads, [path.resolve("/proj/tests/data.csv")]);
    });

    it("answers fileMissing when the file cannot be read", () => {
      const lookup = createCsvCellLookup(script, () => {
        throw new Error("ENOENT");
      });
      assert.deepStrictEqual(lookup("nope.csv", 1, 1), { status: "fileMissing" });
    });
  });

  describe("renderCsvCellMarkdown", () => {
    const table = parseCsvTable("name,course\nA,10\nB,20");
    const ref = { file: "d.csv", line: 3, col: 2 };

    it("shows the value, the column's first line and the row", () => {
      const md = renderCsvCellMarkdown(ref, lookupCsvCell(table, 3, 2), "/p/d.csv");
      assert.match(md, /Value: `20`/);
      assert.match(md, /Column 2, line 1: `course`/);
      assert.match(md, /Line 3 \(2 column\(s\)\): `B` , \*\*`20`\*\*/);
      assert.match(md, /Resolved to `\/p\/d\.csv`/);
    });

    it("omits the first-line context when the cell is on line 1", () => {
      const md = renderCsvCellMarkdown(
        { file: "d.csv", line: 1, col: 1 },
        lookupCsvCell(table, 1, 1),
        "/p/d.csv"
      );
      assert.doesNotMatch(md, /Column 1, line 1/);
    });

    it("says what is missing", () => {
      assert.match(
        renderCsvCellMarkdown(ref, lookupCsvCell(undefined, 3, 2), "/p/d.csv"),
        /Cell not found: file not found or unreadable\./
      );
      assert.match(
        renderCsvCellMarkdown(ref, lookupCsvCell(table, 9, 2), "/p/d.csv"),
        /Cell not found: the file has 3 line\(s\)\./
      );
      assert.match(
        renderCsvCellMarkdown(ref, lookupCsvCell(table, 3, 5), "/p/d.csv"),
        /Cell not found: line 3 has 2 column\(s\)\./
      );
    });

    it("marks an empty cell and survives backticks", () => {
      const t = parseCsvTable("a`b,");
      assert.match(renderCsvCellMarkdown({ file: "d.csv", line: 1, col: 2 }, lookupCsvCell(t, 1, 2), "/p"), /Value: \*\(empty\)\*/);
      assert.match(renderCsvCellMarkdown({ file: "d.csv", line: 1, col: 1 }, lookupCsvCell(t, 1, 1), "/p"), /Value: `` a`b ``/);
    });

    it("explains an ambiguous address instead of guessing", () => {
      const t = parseCsvTable('"x\ny",c\nd,e');
      assert.match(
        renderCsvCellMarkdown({ file: "d.csv", line: 2, col: 1 }, lookupCsvCell(t, 2, 1), "/p"),
        /Not resolved/
      );
    });
  });
});
