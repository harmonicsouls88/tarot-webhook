/**
 * 既存 theme JSON → variants JSON へ自動変換
 * - 既存文言はすべて standard に入れる
 * - soft / push は空（後で手入れ）
 */

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(process.cwd(), "data/themes");
const OUT_DIR = path.join(process.cwd(), "data/themes");

const files = fs
  .readdirSync(SRC_DIR)
  .filter(f => f.endsWith(".json") && !f.endsWith(".variants.json"));

function migrate(file) {
  const srcPath = path.join(SRC_DIR, file);
  const raw = fs.readFileSync(srcPath, "utf8");
  const json = JSON.parse(raw);

  const out = {
    id: json.id,
    label: json.label,
    toneKeys: ["soft", "standard", "push"],
    append: {}
  };

  const append = json.append || {};

  for (const key of Object.keys(append)) {
    const value = append[key];

    // 文字列だけ変換（安全）
    if (typeof value === "string") {
      out.append[key] = {
        soft: "",
        standard: value,
        push: ""
      };
    }
  }

  const outName = file.replace(".json", ".variants.json");
  const outPath = path.join(OUT_DIR, outName);

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

  console.log(`✅ migrated: ${file} → ${outName}`);
}

files.forEach(migrate);