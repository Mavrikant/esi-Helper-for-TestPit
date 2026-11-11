import * as assert from "assert";
import * as path from "path";
import {
  csvCellRefAt,
  findExistingFileRefs,
  findFileRefs,
  parseCsvCellRef,
  resolveScriptRelative,
} from "../../lib/fileRefs";

describe("fileRefs", () => {
  describe("parseCsvCellRef", () => {
    it("parses file, line and col", () => {
      assert.deepStrictEqual(parseCsvCellRef("fix.csv line:4 col:1"), {
        file: "fix.csv",
        line: 4,
        col: 1,
        length: 20,
      });
    });

    it("tolerates blanks around ':' and a folder in the file", () => {
      const r = parseCsvCellRef("..\\data\\fix.CSV line : 12 col: 3  # c");
      assert.strictEqual(r?.file, "..\\data\\fix.CSV");
      assert.strictEqual(r?.line, 12);
      assert.strictEqual(r?.col, 3);
    });

    it("does not match a macro, a non-csv file or a bare file name", () => {
      assert.strictEqual(parseCsvCellRef("%DIR%\\fix.csv line:1 col:1"), undefined);
      assert.strictEqual(parseCsvCellRef("fix.csv line:%N% col:1"), undefined);
      assert.strictEqual(parseCsvCellRef("fix.txt line:1 col:1"), undefined);
      assert.strictEqual(parseCsvCellRef("fix.csv"), undefined);
    });
  });

  describe("findFileRefs", () => {
    it("finds a CSV cell ref with the file range and the whole-ref end", () => {
      const line = "    SDI = fix.csv line:4 col:1";
      const refs = findFileRefs(line);
      assert.strictEqual(refs.length, 1);
      const r = refs[0];
      assert.strictEqual(r.kind, "csvCell");
      assert.strictEqual(line.slice(r.startCol, r.endCol), "fix.csv");
      assert.strictEqual(line.slice(r.startCol, r.refEndCol), "fix.csv line:4 col:1");
      assert.strictEqual(r.csvLine, 4);
      assert.strictEqual(r.csvCol, 1);
    });

    it("takes the whole value of 'include file' (spaces allowed, key spacing free)", () => {
      const line = "        include file  = ..\\Utilities\\Restart VORILS.esi   # note";
      const refs = findFileRefs(line);
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].kind, "path");
      assert.strictEqual(refs[0].key, "include file");
      assert.strictEqual(refs[0].path, "..\\Utilities\\Restart VORILS.esi");
      assert.strictEqual(line.slice(refs[0].startCol, refs[0].endCol), refs[0].path);
    });

    it("takes the whole value of 'result file' and strips quotes", () => {
      const line = '    Result File = "out/res.txt"';
      const refs = findFileRefs(line);
      assert.strictEqual(refs[0].path, "out/res.txt");
      assert.strictEqual(line.slice(refs[0].startCol, refs[0].endCol), "out/res.txt");
    });

    it("finds grammar-shaped path tokens in other values", () => {
      const line = "    system call  = python ../../Utilities/DumpReadLog.py -o report.html";
      const refs = findFileRefs(line);
      assert.deepStrictEqual(
        refs.map((r) => r.path),
        ["../../Utilities/DumpReadLog.py", "report.html"]
      );
      for (const r of refs) {
        assert.strictEqual(line.slice(r.startCol, r.endCol), r.path);
      }
    });

    it("ignores numbers, enum names, N/A and plain words", () => {
      assert.deepStrictEqual(findFileRefs("    Course = 100.5"), []);
      assert.deepStrictEqual(findFileRefs("    SDI = INSTALLATION_NUMBER_ONE"), []);
      assert.deepStrictEqual(findFileRefs("    ip = 192.168.0.1"), []);
      assert.deepStrictEqual(findFileRefs("    x = N/A"), []);
      assert.deepStrictEqual(findFileRefs("    x = .py"), []);
    });

    it("never yields a reference that holds a %macro%", () => {
      assert.deepStrictEqual(findFileRefs("    include file = %ROOT%\\a.esi"), []);
      assert.deepStrictEqual(findFileRefs("    system call = %PY% %DIR%/x.py"), []);
      assert.deepStrictEqual(findFileRefs("    SDI = %D%\\fix.csv line:1 col:1"), []);
    });

    it("ignores comments, tags and prose lines", () => {
      assert.deepStrictEqual(findFileRefs("# include file = a.esi"), []);
      assert.deepStrictEqual(findFileRefs("    x = 1 # see notes.txt"), []);
      assert.deepStrictEqual(findFileRefs("[INCLUDE]"), []);
      assert.deepStrictEqual(findFileRefs("see report.html for details"), []);
      assert.deepStrictEqual(findFileRefs("    include file ="), []);
    });
  });

  describe("csvCellRefAt", () => {
    const line = "    SDI = fix.csv line:4 col:1  # c";
    it("hits anywhere on the reference, not beside it", () => {
      assert.ok(csvCellRefAt(line, 10));
      assert.ok(csvCellRefAt(line, 29));
      assert.strictEqual(csvCellRefAt(line, 5), undefined);
      assert.strictEqual(csvCellRefAt(line, 33), undefined);
    });
    it("is undefined for a non-CSV reference", () => {
      assert.strictEqual(csvCellRefAt("    include file = a.esi", 20), undefined);
    });
  });

  describe("resolveScriptRelative", () => {
    it("resolves against the script's folder (POSIX: '\\' is a separator)", () => {
      assert.strictEqual(
        resolveScriptRelative("/p/tests/a.esi", "..\\Utilities\\r.esi", path.posix),
        "/p/Utilities/r.esi"
      );
      assert.strictEqual(resolveScriptRelative("/p/tests/a.esi", "d.csv", path.posix), "/p/tests/d.csv");
    });
    it("resolves Windows paths and keeps an absolute one", () => {
      assert.strictEqual(
        resolveScriptRelative("C:\\p\\tests\\a.esi", "..\\Utilities\\r.esi", path.win32),
        "C:\\p\\Utilities\\r.esi"
      );
      assert.strictEqual(
        resolveScriptRelative("C:\\p\\tests\\a.esi", "D:\\x\\y.csv", path.win32),
        "D:\\x\\y.csv"
      );
    });
  });

  describe("findExistingFileRefs", () => {
    const script = path.resolve("/p/tests/a.esi");
    const text = [
      "[INCLUDE]",
      "    include file = ../Utilities/r.esi",
      "[/INCLUDE]",
      "    SDI = d.csv line:2 col:1",
      "    Course = gone.csv line:2 col:1",
      "    SDI = d.csv line:3 col:1",
    ].join("\r\n");

    it("keeps only references whose target exists, probing each target once", () => {
      const probed: string[] = [];
      const existing = new Set([path.resolve("/p/Utilities/r.esi"), path.resolve("/p/tests/d.csv")]);
      const refs = findExistingFileRefs(text, script, (p) => {
        probed.push(p);
        return existing.has(p);
      });
      assert.deepStrictEqual(
        refs.map((r) => [r.lineNumber, r.kind, r.target]),
        [
          [1, "path", path.resolve("/p/Utilities/r.esi")],
          [3, "csvCell", path.resolve("/p/tests/d.csv")],
          [5, "csvCell", path.resolve("/p/tests/d.csv")],
        ]
      );
      assert.strictEqual(probed.length, 3);
    });
  });
});
