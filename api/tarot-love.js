// /api/tarot-love.js
// CommonJS (Vercel Node)
// 役割：form11(入力) → カード＆テーマを抽出 → cards json を読み込み → form12へ writeBack（freeで出力）

const fs = require("fs");
const path = require("path");
const querystring = require("querystring");

function log(...args) {
  console.log(...args);
}

function safeStr(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try { return String(v); } catch { return ""; }
}

function normalizeSpaces(s) {
  return safeStr(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = safeStr(obj[k]).trim();
      if (v) return v;
    }
  }
  return "";
}

function findAnyKeyValue(obj, pattern) {
  if (!obj) return "";
  for (const k of Object.keys(obj)) {
    if (pattern.test(k)) {
      const v = safeStr(obj[k]).trim();
      if (v) return v;
    }
  }
  return "";
}

function normalizeTheme(raw) {
  const s = safeStr(raw).trim().toLowerCase();
  if (["love", "work", "money", "health"].includes(s)) return s;
  if (s.includes("love") || s.includes("恋愛")) return "love";
  if (s.includes("work") || s.includes("仕事")) return "work";
  if (s.includes("money") || s.includes("金運") || s.includes("金")) return "money";
  if (s.includes("health") || s.includes("健康")) return "health";
  return "";
}

function extractCardId(pasted) {
  const text = normalizeSpaces(pasted);
  const m =
    text.match(/card_id\s*[:=]\s*([a-z0-9_]+)\b/i) ||
    text.match(/cardId\s*[:=]\s*([a-z0-9_]+)\b/i);
  if (m && m[1]) return m[1].trim();

  const m2 = text.match(/\b(major_\d{2}|cups_\d{2}|wands_\d{2}|swords_\d{2}|pentacles_\d{2})\b/i);
  if (m2 && m2[1]) return m2[1].trim();

  return "";
}

function cardPathFor(cardId) {
  const isMajor = /^major_\d{2}$/i.test(cardId);
  const base = path.join(process.cwd(), "cards", "common", isMajor ? "major" : "minor");
  return path.join(base, `${cardId}.json`);
}

function themePathFor(theme) {
  const base = path.join(process.cwd(), "cards", "theme");
  return path.join(base, `${theme}.json`);
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { __error: true, __errorMessage: e && e.message ? e.message : String(e), __path: filePath };
  }
}


function splitForFreeFields(longText) {
  const LIMIT = 160;
  const s = normalizeSpaces(longText);
  if (!s) return { p1: "", p2: "", p3: "", p4: "" };

  const parts = [];
  let cur = s;

  while (cur.length > LIMIT && parts.length < 3) {
    const cutAt = cur.lastIndexOf("\n", LIMIT);
    const idx = cutAt > 80 ? cutAt : LIMIT;
    parts.push(cur.slice(0, idx).trim());
    cur = cur.slice(idx).trim();
  }
  parts.push(cur.trim());

  return {
    p1: parts[0] || "",
    p2: parts[1] || "",
    p3: parts[2] || "",
    p4: parts[3] || "",
  };
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

// ✅二重宣言しない（ここだけ）
const ZWSP = "\u200b"; // ゼロ幅スペース
const safe = (v) => {
  const s = (v == null ? "" : String(v)).trim();
  return s ? s : ZWSP; // 空でも必ず上書きする
};

async function postForm(url, data) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data || {})) {
    params.set(k, v == null ? "" : String(v));
  }

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: params.toString(),
  });

  const text = await r.text().catch(() => "");
  return { ok: r.ok, status: r.status, text };
}

// ✅ここは固定でOK
const WRITEBACK_URL = "https://l8x1uh5r.autosns.app/fm/xBi34LzVvN";

module.exports = async (req, res) => {
  const started = Date.now();

  try {
    if (req.method !== "POST") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, message: "POST only" }));
      return;
    }

    const rawBody = await readBody(req);
    const body = querystring.parse(rawBody);

    const uid =
      pickFirst(body, ["uid", "user_id", "userid"]) ||
      findAnyKeyValue(body, /^form_data\[uid\]$/i);

    const pasted =
      pickFirst(body, ["form11-1", "form_data[form11-1]"]) ||
      findAnyKeyValue(body, /form11-1/i) ||
      pickFirst(body, ["pasted", "text", "message"]);

    const cardId = extractCardId(pasted);

    const themeRaw =
      pickFirst(body, ["theme", "form11-5", "form_data[form11-5]"]) ||
      findAnyKeyValue(body, /form11-5/i) ||
      findAnyKeyValue(body, /theme/i);

    const theme = normalizeTheme(themeRaw) || "love";

    log(`[tarot-love] uid: ${uid || ""}`);
    log(`[tarot-love] themeRaw: ${safeStr(themeRaw)}`);
    log(`[tarot-love] theme: ${theme}`);
    log(`[tarot-love] pasted head: ${normalizeSpaces(pasted).slice(0, 120).replace(/\n/g, "\\n")}`);
    log(`[tarot-love] cardId: ${cardId}`);

    if (!uid || !cardId) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, message: "missing uid or card_id", uid: uid || "", theme, cardId: cardId || "" }));
      return;
    }

    const commonPath = cardPathFor(cardId);
    const themePath = themePathFor(theme);

    const commonJson = readJson(commonPath);
    const themeJson = readJson(themePath);

    log(`[tarot-love] commonFrom: ${commonPath}`);
    log(`[tarot-love] themeFrom: ${themePath}`);
    log(`[tarot-love] addon: ${themeJson && !themeJson.__error ? "yes" : "no"}`);

    const commonLine = (commonJson && !commonJson.__error && commonJson.line) ? commonJson.line : {};

    const shortText =
      safeStr(commonLine.short).trim() ||
      (commonJson && !commonJson.__error ? `今日は「${safeStr(commonJson.title)}」の整え。小さくでOKです🌿` : "");

    let longBase = "";
    if (safeStr(commonLine.long).trim()) longBase = safeStr(commonLine.long).trim();
    else if (safeStr(commonLine.full).trim()) longBase = safeStr(commonLine.full).trim();
    else if (commonJson && !commonJson.__error) {
      const lines = [];
      lines.push(`🌿 今日の整えワンポイント（詳細）`);
      lines.push(``);
      lines.push(`【カード】 ${safeStr(commonJson.title)}`);
      if (safeStr(commonJson.message).trim()) lines.push(safeStr(commonJson.message).trim());
      lines.push(``);
      if (safeStr(commonJson.focus).trim()) {
        lines.push(`【意識すること】`);
        lines.push(safeStr(commonJson.focus).trim());
        lines.push(``);
      }
      if (safeStr(commonJson.action).trim()) {
        lines.push(`【今日の一歩】`);
        lines.push(safeStr(commonJson.action).trim());
      }
      longBase = lines.join("\n").trim();
    }

    const ids = altCardIds(cardId);
const themeAddon = (themeJson && !themeJson.__error)
  ? (ids.map(k => safeStr(themeJson[k]).trim()).find(Boolean) || "")
  : "";

    let longText = longBase;
    if (themeAddon) {
      longText = `${longBase}\n\n【${themeLabel(theme)}の視点】\n${themeAddon}`.trim();
    }

    
    const { p1, p2, p3, p4 } = splitForFreeFields(longText);

    log(`[tarot-love] len free6(short): ${shortText.length}`);
    log(`[tarot-love] len free5(long1): ${p1.length}`);
    log(`[tarot-love] len free1(long2): ${p2.length}`);
    log(`[tarot-love] len free3(long3): ${p3.length}`);
    log(`[tarot-love] len free4(long4): ${p4.length}`);

    // ✅writeBack：分割保存＋毎回上書き（混入防止）
const CLEAR = "__CLR__";

// ✅writeBack：分割保存 + 毎回上書き（混入防止）
const payload = {
  uid,

  free6: safe(shortText), // 短文

  free5: safe(p1),        // 長文1
  free1: safe(p2),        // 長文2
  free3: safe(p3),        // 長文3
  free4: safe(p4),        // 長文4

  // 使ってなくても毎回上書き（過去混入を根絶）
  free2: ZWSP,
};

    const wb = await postForm(WRITEBACK_URL, payload);
    log(`[tarot-love] writeBack POST: ${WRITEBACK_URL}`);
    log(`[tarot-love] writeBack status: ${wb.status}`);

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: true,
      uid,
      theme,
      cardId,
      writeBack: { ok: wb.ok, status: wb.status },
      ms: Date.now() - started,
    }));
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  }
};

function themeLabel(theme) {
  switch (theme) {
    case "love": return "恋愛";
    case "work": return "仕事";
    case "money": return "金運";
    case "health": return "健康";
    default: return theme;
  }
}
