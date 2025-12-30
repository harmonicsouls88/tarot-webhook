/* scripts/build-theme-jsons.js */
const fs = require("fs");
const path = require("path");

const TONE = process.env.TONE || "standard";
const SRC_DIR = path.join(process.cwd(), "data/themes");
const OUT_DIR = path.join(process.cwd(), "data/themes/active");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function pickToneValue(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    // 形式: { soft, standard, push }
    if (typeof v[TONE] === "string") return v[TONE];
    // fallback順
    if (typeof v.standard === "string") return v.standard;
    const first = Object.values(v).find(x => typeof x === "string");
    return first || "";
  }
  // 既存の文字列形式ならそのまま
  if (typeof v === "string") return v;
  return "";
}

function buildOne(file) {
  const srcPath = path.join(SRC_DIR, file);
  const raw = fs.readFileSync(srcPath, "utf8");
  const json = JSON.parse(raw);

  const append = {};
  const srcAppend = json.append || {};

  for (const key of Object.keys(srcAppend)) {
    append[key] = pickToneValue(srcAppend[key]);
  }

  const out = {
    id: json.id,
    label: json.label,
    append
  };

  const outPath = path.join(OUT_DIR, `${json.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`[theme] ${json.id}: tone=${TONE} -> ${outPath}`);
}

const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith(".variants.json"));
files.forEach(buildOne);