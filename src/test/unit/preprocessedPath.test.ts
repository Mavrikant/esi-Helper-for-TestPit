import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import {
  preprocessedEsiPath,
  preprocessedOpenFailureMessage,
} from "../../lib/preprocessedPath";

describe("preprocessedPath", () => {
  describe("preprocessedEsiPath", () => {
    it("builds the Windows path under the given home directory", () => {
      assert.strictEqual(
        preprocessedEsiPath("C:\\Users\\alice", path.win32),
        "C:\\Users\\alice\\Documents\\Testpit\\Preprocessed.esi"
      );
    });

    it("honours a home directory that is not C:\\Users\\<login>", () => {
      assert.strictEqual(
        preprocessedEsiPath("D:\\Profiles\\a.b\\", path.win32),
        "D:\\Profiles\\a.b\\Documents\\Testpit\\Preprocessed.esi"
      );
    });

    it("defaults to the host's path.join", () => {
      assert.strictEqual(
        preprocessedEsiPath(os.homedir()),
        path.join(os.homedir(), "Documents", "Testpit", "Preprocessed.esi")
      );
    });
  });

  describe("preprocessedOpenFailureMessage", () => {
    it("names the path that was tried and hints at the validity check", () => {
      const p = "C:\\Users\\alice\\Documents\\Testpit\\Preprocessed.esi";
      const msg = preprocessedOpenFailureMessage(p);
      assert.ok(msg.includes(p));
      assert.match(msg, /validity check/i);
    });
  });
});
