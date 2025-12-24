
// /api/tarot-love.js
// CommonJS (Vercel Node)
// 役割：form11(入力) → カード＆テーマを抽出 → cards json を読み込み → form12へ writeBack（freeだけで出力）

const fs = require("fs");
const path = require("path");
const querystring = require("querystring");

function now() {
  return new Date().toISOString();
}

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

  // 既に love/work/money/health が来るケース
  if (["love", "work", "money", "health"].includes(s)) return s;

  // 表示が "money（金運）" みたいなケース
  if (s.includes("love") || s.includes("恋愛")) return "love";
  if (s.includes("work") || s.includes("仕事")) return "work";
  if (s.includes("money") || s.includes("金運") || s.includes("金")) return "money";
  if (s.includes("health") || s.includes("健康")) return "health";

  // 何も取れない時
  return "";
}

function extractCardId(pasted) {
  const text = normalizeSpaces(pasted);

  // 例: card_id:pentacles_05 / card_id=major_20 / "card_id: swords_13"
  const m =
    text.match(/card_id\s*[:=]\s*([a-z0-9_]+)\b/i) ||
    text.match(/cardId\s*[:=]\s*([a-z0-9_]+)\b/i);

  if (m && m[1]) return m[1].trim();

  // 最低限：major_XX / cups_XX などが単独で貼られた場合
  const m2 = text.match(/\b(major_\d{2}|cups_\d{2}|wands_\d{2}|swords_\d{2}|pentacles_\d{2}|cups_\d{2}|wands_\d{2}|swords_\d{2}|pentacles_\d{2})\b/i);
  if (m2 && m2[1]) return m2[1].trim();

  return "";
}

function cardPathFor(cardId) {
  // major は common/major, それ以外は common/minor 扱い
  const isMajor = /^major_\d{2}$/i.test(cardId);

  // 重要：Vercel上の実パスは /var/task/...
  // このファイルと同階層に cards/ がある前提
  const base = path.join(process.cwd(), "cards", "common", isMajor ? "major" : "minor");
  return path.join(base, `${cardId}.json`);
}

function themePathFor(theme) {
  const base = path.join(process.cwd(), "cards", "theme");
  return path.join(base, `${theme}.json`);
}

function readJson(filePath) {
  // 見つからなくても落とさない
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { __error: true, __errorMessage: e && e.message ? e.message : String(e), __path: filePath };
  }
}

function splitForFreeFields(longText) {
  // free系は 250〜350文字あたりで切れることが多いので、余裕を見て分割
  const LIMIT = 230;

  const s = normalizeSpaces(longText);
  if (!s) return { p1: "", p2: "", p3: "", p4: "" };

  const parts = [];
  let cur = s;

  while (cur.length > LIMIT && parts.length < 3) {
    // なるべく改行位置で切る
    const cutAt = cur.lastIndexOf("\n", LIMIT);
    const idx = cutAt > 80 ? cutAt : LIMIT; // 極端に短くならないように
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

const ZWSP = "\u200b"; // ゼロ幅スペース（見えないけど「空じゃない」）
const safe = (v) => {
  const s = (v == null ? "" : String(v)).trim();
  return s ? s : ZWSP;  // 空ならZWSPを入れて「確実に上書き」させる
};

async function postForm(url, data) {
  // ProLineは「application/x-www-form-urlencoded」が安定
  const params = new URLSearchParams();

  for (const [k, v] of Object.entries(data || {})) {
    // undefined / null は空文字にして「上書き消去」できるようにする
    params.set(k, v == null ? "" : String(v));
  }

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: params.toString(),
  });

  const text = await r.text().catch(() => "");
  return { ok: r.ok, status: r.status, text };
}

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

    // ====== 基本情報 ======
    const uid =
      pickFirst(body, ["uid", "user_id", "userid"]) ||
      findAnyKeyValue(body, /^form_data\[uid\]$/i);

    // ====== form11：カード貼り付け欄（form11-1 想定） ======
    // ProLineは key が色々来るので「form11-1 を含むキー」も拾う
    const pasted =
      pickFirst(body, ["form11-1", "form_data[form11-1]"]) ||
      findAnyKeyValue(body, /form11-1/i) ||
      pickFirst(body, ["pasted", "text", "message"]);

    const cardId = extractCardId(pasted);

    // ====== form11：テーマ（form11-5 ラジオ推奨） ======
    const themeRaw =
      pickFirst(body, ["theme", "form11-5", "form_data[form11-5]"]) ||
      findAnyKeyValue(body, /form11-5/i) ||
      findAnyKeyValue(body, /theme/i);

    const theme = normalizeTheme(themeRaw) || "love"; // 最後は love でフォールバック

    log(`[tarot-love] uid: ${uid || ""}`);
    log(`[tarot-love] themeRaw: ${safeStr(themeRaw)}`);
    log(`[tarot-love] theme: ${theme}`);
    log(`[tarot-love] pasted head: ${normalizeSpaces(pasted).slice(0, 120).replace(/\n/g, "\\n")}`);
    log(`[tarot-love] cardId: ${cardId}`);

    // ====== 必要情報が無いときも 200で返す（ProLine保護） ======
    if (!uid || !cardId) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: false,
          message: "missing uid or card_id",
          uid: uid || "",
          theme,
          cardId: cardId || "",
        })
      );
      return;
    }

    // ====== JSON 読み込み ======
    const commonPath = cardPathFor(cardId);
    const themePath = themePathFor(theme);

    const commonJson = readJson(commonPath);
    const themeJson = readJson(themePath);

    log(`[tarot-love] commonFrom: ${commonPath}`);
    log(`[tarot-love] themeFrom: ${themePath}`);
    log(`[tarot-love] addon: ${themeJson && !themeJson.__error ? "yes" : "no"}`);

    // ====== 出力文面作成（短文/長文） ======
    // 期待：cards/common/*/*.json に line.short / line.long などがある
    // themeJson は { "major_09": "...", ... } みたいな辞書でもOK
    const commonLine = (commonJson && !commonJson.__error && commonJson.line) ? commonJson.line : {};

    // 短文：line.short があれば優先、なければ title から作る
    const shortText =
      safeStr(commonLine.short).trim() ||
      (commonJson && !commonJson.__error ? `今日は「${safeStr(commonJson.title)}」の整え。小さくでOKです🌿` : "");

    // 長文（ベース）：line.long → line.full → message+focus+action
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

    // テーマ別の一言（辞書型・keyが cardId のケース）
    const themeAddon =
      (themeJson && !themeJson.__error && themeJson[cardId]) ? safeStr(themeJson[cardId]).trim() : "";

    // 最終長文：ベース + テーマ別
    let longText = longBase;
    if (themeAddon) {
      longText = `${longBase}\n\n【${themeLabel(theme)}の視点】\n${themeAddon}`.trim();
    }

    // 末尾にデバッグを入れたい時（必要ならONに）
    // longText += `\n\n---\nDEBUG\n${cardId}\n${theme}`;

    // ====== freeフィールド対策で分割 ======
    const { p1, p2, p3, p4 } = splitForFreeFields(longText);

    // 短文も念のためログ
    log(`[tarot-love] len free6(short): ${shortText.length}`);
    log(`[tarot-love] len free5(long1): ${p1.length}`);
    log(`[tarot-love] len free1(long2): ${p2.length}`);
    log(`[tarot-love] len free3(long3): ${p3.length}`);
    log(`[tarot-love] len free4(long4): ${p4.length}`);

    // ====== writeBack（form12） ======
    // あなたのログで writeBack 先はこれ：
   // ====== writeBack（form12） ======
const WRITEBACK_URL = "https://l8x1uh5r.autosns.app/fm/xBi34LzVvN";

const ZWSP = "\u200B";
const safe = (s) => {
  s = (s ?? "").toString();
  return s.length ? s : ZWSP; // 空はZWSPで必ず上書き
};

const payload = {
  uid,

  // 結果（短文/長文）
  free6: safe(shortText), // 短文
  free5: safe(p1),        // 長文（メイン）

  // ★ここが超重要：使わなくても毎回“消す”（過去混入を根絶）
  free1: ZWSP,
  free2: ZWSP,
  free3: ZWSP,
  free4: ZWSP,
};

const wb = await postForm(WRITEBACK_URL, payload);

log(`[tarot-love] writeBack POST: ${WRITEBACK_URL}`);
log(`[tarot-love] writeBack status: ${wb.status}`);

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: true,
        uid,
        theme,
        cardId,
        writeBack: { ok: wb.ok, status: wb.status },
        ms: Date.now() - started,
      })
    );
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);

    // 500にするとProLineが混乱するので200で返す
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
