// Build icons/testpit.woff from icons/*.svg.
// Pipeline: SVG glyphs -> SVG font -> TTF -> WOFF.
//
// Each SVG in icons/ becomes one glyph keyed at unicode E001+, in alphabetical
// order. The icon `id` you reference from `contributes.icons` in package.json
// must match the SVG filename (without extension), and `fontCharacter` must
// match the assigned codepoint (printed at the end of this script).

const fs = require("fs");
const path = require("path");
const { SVGIcons2SVGFontStream } = require("svgicons2svgfont");
const svg2ttf = require("svg2ttf");
const ttf2woff = require("ttf2woff");

const ICONS_DIR = path.join(__dirname, "..", "icons");
const FONT_NAME = "testpit-icons";
const START_CODEPOINT = 0xe001;

const svgFiles = fs
  .readdirSync(ICONS_DIR)
  .filter((f) => f.toLowerCase().endsWith(".svg"))
  .sort();

if (svgFiles.length === 0) {
  console.error("No SVG icons found in", ICONS_DIR);
  process.exit(1);
}

const stream = new SVGIcons2SVGFontStream({
  fontName: FONT_NAME,
  normalize: true,
  fontHeight: 1024,
  log: () => {},
});

let svgFontData = "";
stream.on("data", (chunk) => (svgFontData += chunk.toString()));
stream.on("end", () => {
  const ttf = Buffer.from(svg2ttf(svgFontData, { description: FONT_NAME }).buffer);
  const woff = Buffer.from(ttf2woff(ttf).buffer);
  const woffPath = path.join(ICONS_DIR, `${FONT_NAME}.woff`);
  fs.writeFileSync(woffPath, woff);
  console.log(`Wrote ${woffPath} (${woff.length} bytes)`);
  for (const [i, file] of svgFiles.entries()) {
    const codepoint = (START_CODEPOINT + i).toString(16).toUpperCase();
    const id = path.basename(file, ".svg");
    console.log(`  ${id} -> \\${codepoint}`);
  }
});
stream.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

for (const [i, file] of svgFiles.entries()) {
  const codepoint = START_CODEPOINT + i;
  const id = path.basename(file, ".svg");
  const glyph = fs.createReadStream(path.join(ICONS_DIR, file));
  glyph.metadata = {
    name: id,
    unicode: [String.fromCodePoint(codepoint)],
  };
  stream.write(glyph);
}
stream.end();
