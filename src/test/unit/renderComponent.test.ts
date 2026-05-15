import * as assert from "assert";
import * as path from "path";
import { parseConfigFolder } from "../../lib/xmlIndex";
import {
  renderConnection,
  renderEnum,
  renderField,
} from "../../lib/renderComponent";

const FIXTURE_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "test",
  "fixtures",
  "config"
);

const idx = parseConfigFolder(FIXTURE_DIR);

describe("renderComponent", () => {
  describe("renderConnection", () => {
    it("includes the connection fullName, bus label, label, card/channel/speed", () => {
      const conn = idx.connections.get("429_L100SelectedCourseBNR_input1")!;
      const md = renderConnection(conn, idx);
      assert.match(md.value, /429_L100SelectedCourseBNR_input1/);
      assert.match(md.value, /ARINC 429/);
      assert.match(md.value, /Label.*100/);
      assert.match(md.value, /Card.*Channel.*Speed/);
    });

    it("includes the resolved message name and field list", () => {
      const conn = idx.connections.get("429_L100SelectedCourseBNR_input1")!;
      const md = renderConnection(conn, idx);
      assert.match(md.value, /SelectedCourseBNR/);
      assert.match(md.value, /Fields.*3/);
      assert.match(md.value, /SDI/);
      assert.match(md.value, /Course/);
    });

    it("renders a discrete connection with the DIS bus label", () => {
      const conn = idx.connections.get("DIS_PowerOnOff")!;
      const md = renderConnection(conn, idx);
      assert.match(md.value, /DIS/);
      assert.match(md.value, /PowerOnOff/);
    });

    it("renders a memory port (no label, no card/channel/speed)", () => {
      const conn = idx.connections.get("Mem_RNEGeneralWriteLedStatus")!;
      const md = renderConnection(conn, idx);
      assert.match(md.value, /Memory/);
      assert.match(md.value, /RNEGeneralWriteLedStatus/);
      // Should NOT contain a Label line — memory ports don't have one.
      assert.doesNotMatch(md.value, /Label.*\d/);
    });
  });

  describe("renderField", () => {
    it("renders an Enum field with its enum table", () => {
      const msg = idx.messages.get("SelectedCourseBNR")!;
      const sdi = msg.fields.find((f) => f.name === "SDI")!;
      const md = renderField(sdi, msg);
      assert.match(md.value, /SDI/);
      assert.match(md.value, /Enum/);
      assert.match(md.value, /INSTALLATION_NUMBER_ALL_CALL/);
      assert.match(md.value, /INSTALLATION_NUMBER_ONE/);
      assert.match(md.value, /Default.*INSTALLATION_NUMBER_ALL_CALL/);
    });

    it("renders a BNR field with min/max/resolution and unit", () => {
      const msg = idx.messages.get("SelectedCourseBNR")!;
      const course = msg.fields.find((f) => f.name === "Course")!;
      const md = renderField(course, msg);
      assert.match(md.value, /Course/);
      assert.match(md.value, /BNR/);
      assert.match(md.value, /min.*0/);
      assert.match(md.value, /max.*359\.9/);
      assert.match(md.value, /Unit.*deg/);
    });

    it("includes the parent message name when provided", () => {
      const msg = idx.messages.get("SelectedCourseBNR")!;
      const sdi = msg.fields.find((f) => f.name === "SDI")!;
      const md = renderField(sdi, msg);
      assert.match(md.value, /From message.*SelectedCourseBNR/);
    });

    it("works without a parent message (caller may pass undefined)", () => {
      const msg = idx.messages.get("SelectedCourseBNR")!;
      const sdi = msg.fields.find((f) => f.name === "SDI")!;
      const md = renderField(sdi, undefined);
      assert.match(md.value, /SDI/);
      assert.doesNotMatch(md.value, /From message/);
    });
  });

  describe("renderEnum", () => {
    it("renders the enum name, numeric value, parent field, parent message", () => {
      const msg = idx.messages.get("SelectedCourseBNR")!;
      const sdi = msg.fields.find((f) => f.name === "SDI")!;
      const enumDef = sdi.enums!.find((e) => e.name === "INSTALLATION_NUMBER_ONE")!;
      const md = renderEnum(enumDef, sdi, msg);
      assert.match(md.value, /INSTALLATION_NUMBER_ONE.*=.*1/);
      assert.match(md.value, /SDI/);
      assert.match(md.value, /SelectedCourseBNR/);
    });
  });
});
