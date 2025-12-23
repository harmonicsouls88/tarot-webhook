
// /api/tarot-love.js
// ProLine -> Vercel webhook
const fs = require("fs");
const path = require("path");

const WRITEBACK_URL = "https://l8x1uh5r.autosns.app/fm/xBi34LzVvN";

// free は1項目あたり上限が低いっぽいので分割（安全側に）
const FREE_LIMIT = 280;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function safeStr(v) {
  return (v ?? "").toString().trim();
}

// ProLine の POST は JSON のこともあれば、x-www-form-urlencoded のこともある
async function parseBody(req) {
  const ct = (req.headers["content-type"] || "").toLowerCase();
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");

  if (ct.includes("application/json")) {
    try {
      return { raw, body: JSON.parse(raw) };
    } catch {
      return { raw, body: {} };
    }
  }

  // x-www-form-urlencoded
  const params = new URLSearchParams(raw);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return { raw, body: obj };
}

// "form_data[xxx]" をまとめて拾えるようにする
function pickFormData(body) {
  const fd = body.form_data && typeof body.form_data === "object" ? body.form_data : {};
  // form_data[xxx] 形式も吸い上げ
  for (const [k, v] of Object.entries(body)) {
    const m = k.match(/^form_data\[(.+?)\]$/);
    if (m) fd[m[1]] = v;
  }
  return fd;
}

function normalizeTheme(themeRaw) {
  const t = safeStr(themeRaw).toLowerCase();

  // すでに内部キーならそのまま
  if (["love", "work", "money", "health"].includes(t)) return t;

  // 日本語/混在表現を吸収
  if (t.includes("恋愛")) return "love";
  if (t.includes("仕事")) return "work";
  if (t.includes("金運")) return "money";
  if (t.includes("健康")) return "health";

  // 例: "money (金運)" / "money（金運）"
  if (t.includes("money")) return "money";
  if (t.includes("work")) return "work";
  if (t.includes("health")) return "health";
  if (t.includes("love")) return "love";

  // 最後は love に倒す（ただしログでわかるように）
  return "love";
}

function extractCardId(pastedText) {
  const s = safeStr(pastedText);
  // card_id:cups_01 / card_id = major_00 など
  const m = s.match(/card_id\s*[:=]\s*([a-z0-9_]+)/i);
  if (m) return m[1].toLowerCase();
  return "";
}

function commonPathFromCardId(cardId) {
  // major_00 / major_09 ... は major
  if (cardId.startsWith("major_")) {
    return path.join("/var/task/cards/common/major", `${cardId}.json`);
  }
  // minor は cups_01 / wands_08 / pentacles_14 / swords_11 など
  return path.join("/var/task/cards/common/minor", `${cardId}.json`);
}

function themePath(theme) {
  return path.join("/var/task/cards/theme", `${theme}.json`);
}

function buildTexts({ cardId, common, theme, themeAddonText }) {
  const cardName =
    safeStr(common.name) ||
    safeStr(common.title) ||
    safeStr(common.card) ||
    cardId;

  const baseOne =
    safeStr(common.one) ||
    safeStr(common.oneline) ||
    safeStr(common.short) ||
    "";

  // 短文（free6）
  const shortText = baseOne
    ? `今日は「${cardName}」の整え。${baseOne}🌿`
    : `今日は「${cardName}」の整え。小さくでOKです🌿`;

  // 長文（free5 + free1 に分割して保存、CP21で結合表示）
  const lines = [];
  lines.push(`【カード】${cardName}`);
  const desc =
    safeStr(common.desc) ||
    safeStr(common.description) ||
    safeStr(common.long) ||
    "";
  if (desc) lines.push(desc);

  const focus = Array.isArray(common.focus) ? common.focus : [];
  const conscious = Array.isArray(common.conscious) ? common.conscious : [];
  const action = Array.isArray(common.action) ? common.action : [];

  if (focus.length || conscious.length) {
    lines.push("");
    lines.push("【意識すること】");
    [...focus, ...conscious].filter(Boolean).forEach(x => lines.push(`・${x}`));
  }

  if (action.length) {
    lines.push("");
    lines.push("【今日の一手】");
    action.filter(Boolean).forEach(x => lines.push(`・${x}`));
  }

  if (themeAddonText) {
    lines.push("");
    lines.push("【テーマ別メッセージ】");
    lines.push(themeAddonText);
  }

  lines.push("");
  lines.push("🌙 焦らなくて大丈夫。整えた分だけ、現実がついてきます。");

  const longText = lines.join("\n").trim();

  return { shortText, longText };
}

// free 文字数が低いので分割
function splitForFree(longText) {
  const s = safeStr(longText);
  if (s.length <= FREE_LIMIT) {
    return { free5: s, free1: "" };
  }
  return {
    free5: s.slice(0, FREE_LIMIT),
    free1: s.slice(FREE_LIMIT),
  };
}

async function postWriteBack({ uid, free6, free5, free1, free3, free4 }) {
  const params = new URLSearchParams();
  params.set("uid", uid);
  if (free6) params.set("free6", free6); // 短文
  if (free5) params.set("free5", free5); // 長文 前半
  if (free1) params.set("free1", free1); // 長文 後半
  if (free3) params.set("free3", free3); // cardId
  if (free4) params.set("free4", free4); // theme

  const res = await fetch(WRITEBACK_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  return res;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }

    const { body } = await parseBody(req);
    const formData = pickFormData(body);

    const uid =
      safeStr(body.uid) ||
      safeStr(formData.uid) ||
      safeStr(body.basic_id) ||
      safeStr(body.user_id) ||
      "unknown";

    // ---- pasted（カード貼り付け欄）を広く拾う（キーが変わっても耐える）
    const pasted =
      safeStr(formData["form11-1"]) ||
      safeStr(formData["form11-11"]) ||
      safeStr(formData["pasted"]) ||
      safeStr(formData["card"]) ||
      safeStr(body.pasted) ||
      "";

    // ---- theme（ラジオ）も広く拾う
    const themeRaw =
      safeStr(formData["form11-5"]) || // 新しく作ったラジオ（想定）
      safeStr(formData["form11-2"]) ||
      safeStr(formData["theme"]) ||
      safeStr(body.theme) ||
      "";

    const theme = normalizeTheme(themeRaw);
    const cardId = extractCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] themeRaw:", themeRaw);
    console.log("[tarot-love] theme:", theme);
    console.log("[tarot-love] pasted head:", pasted.split("\n").slice(0, 3).join(" / "));
    console.log("[tarot-love] cardId:", cardId);

    if (!cardId) {
      res.statusCode = 400;
      return res.end("Bad Request: card_id not found");
    }

    const commonFrom = commonPathFromCardId(cardId);
    const themeFrom = themePath(theme);

    console.log("[tarot-love] commonFrom:", commonFrom);
    console.log("[tarot-love] themeFrom:", themeFrom);

    const common = readJson(commonFrom);
    const themeJson = readJson(themeFrom);

    const themeAddonText = safeStr(themeJson[cardId] || themeJson[cardId.toLowerCase()] || "");

    const { shortText, longText } = buildTexts({
      cardId,
      common,
      theme,
      themeAddonText,
    });

    // 長さログ（たまみさんが入れてくれたやつ）
    console.log("[tarot-love] len free6(short):", shortText.length);
    console.log("[tarot-love] len long(all):", longText.length);

    const { free5, free1 } = splitForFree(longText);
    console.log("[tarot-love] len free5(long):", free5.length);
    console.log("[tarot-love] len free1(long2):", free1.length);

    // free3/free4 は “表示用” というよりデバッグ用に保存（任意）
    const wb = await postWriteBack({
      uid,
      free6: shortText,
      free5,
      free1,
      free3: cardId,
      free4: theme,
    });

    console.log("[tarot-love] writeBack status:", wb.status);

    res.setHeader("content-type", "application/json; charset=utf-8");
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, uid, theme, cardId }));
  } catch (e) {
    console.log("[tarot-love] ERROR:", e);
    res.statusCode = 500;
    return res.end("Internal Server Error");
  }
};
