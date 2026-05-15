import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { withTempScript } from "../../lib/withTempScript";

describe("withTempScript", () => {
  const baseFile = path.join(os.tmpdir(), `withTempScript-${process.pid}-${Date.now()}.esi`);

  it("writes content to <basePath>.temp and passes that path to the callback", async () => {
    let observedPath = "";
    let observedContent = "";
    await withTempScript(baseFile, "hello world", (tempPath) => {
      observedPath = tempPath;
      observedContent = fs.readFileSync(tempPath, "utf-8");
    });
    assert.strictEqual(observedPath, baseFile + ".temp");
    assert.strictEqual(observedContent, "hello world");
  });

  it("removes the temp file after the callback resolves", async () => {
    await withTempScript(baseFile, "x", () => undefined);
    assert.strictEqual(fs.existsSync(baseFile + ".temp"), false);
  });

  it("removes the temp file even if the callback throws", async () => {
    await assert.rejects(
      withTempScript(baseFile, "x", () => {
        throw new Error("boom");
      }),
      /boom/
    );
    assert.strictEqual(fs.existsSync(baseFile + ".temp"), false);
  });

  it("removes the temp file even if an async callback rejects", async () => {
    await assert.rejects(
      withTempScript(baseFile, "x", async () => {
        throw new Error("async boom");
      }),
      /async boom/
    );
    assert.strictEqual(fs.existsSync(baseFile + ".temp"), false);
  });

  it("returns the value the callback resolves to", async () => {
    const result = await withTempScript(baseFile, "x", () => 42);
    assert.strictEqual(result, 42);
  });

  it("ignores cleanup errors (callback already removed the file)", async () => {
    await assert.doesNotReject(
      withTempScript(baseFile, "x", (tempPath) => {
        fs.unlinkSync(tempPath);
      })
    );
  });
});
