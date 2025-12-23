// /api/tarot-love.js
// ProLine(Webhook) -> Vercel -> ProLine(writeBack to form12)

const fs = require("fs");
const path = require("path");

// ===== 設定 =====
// form12（結果書き出し先）のURL（ログに出ていたもの）
const WRITEBACK_URL = process.env.WRITEBACK_URL || "https://l8x1uh5r.autosns.app/fm/xBi34LzVvN";

// free系の1フィールド上限（ログ的に約300で切れている）
const FREE_LIMIT = 280; // 安全側（改行や絵文字でズレるので少し短く）

// ===== ユーティリティ =====
function safeStr(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(safeStr).join("\n");
  return String(v);
}

function normalizeSpace(s) {
  return safeStr(s).replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
}

// cardIdに混ざる改行/ゴミ文字対策：英数字と_だけ残す
function sanitizeId(id) {
  const t = safeStr(id).trim();
  return t.replace(/[^a-z0-9_]/gi, "");
}

function splitByLimit(text, limit) {
  const s = safeStr(text);
  if (s.length <= limit) return [s, ""];
  return [s.slice(0, limit), s.slice(limit, limit * 2)]; // 2分割（free5/free6）
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function guessThemeFromText(text) {
  const t = normalizeSpace(text).toLowerCase();

  // まず英語
  if (t.includes("money")) return { theme: "money", raw: "money" };
  if (t.includes("love")) return { theme: "love", raw: "love" };
  if (t.includes("work")) return { theme: "work", raw: "work" };
  if (t.includes("health")) return { theme: "health", raw: "health" };

  // 日本語
  if (t.includes("金運")) return { theme: "money", raw: "金運" };
  if (t.includes("恋愛")) return { theme: "love", raw: "恋愛" };
  if (t.includes("仕事")) return { theme: "work", raw: "仕事" };
  if (t.includes("健康")) return { theme: "health", raw: "健康" };

  return { theme: "love", raw: "" }; // デフォルト
}

// form送信ボディの「どこか」に入ってる theme を総当たりで拾う
function extractTheme(reqBody) {
  const candidates = [];

  // 1) ありがちなキー
  const keysLikely = [
    "theme",
    "form_data[theme]",
    "sel[theme]",
    "form_data[sel[theme]]",
  ];
  keysLikely.forEach((k) => candidates.push(safeStr(reqBody?.[k])));

  // 2) form11-* / form12-* の値も全部候補に入れる（どれかに入ってる）
  if (reqBody && typeof reqBody === "object") {
    for (const [k, v] of Object.entries(reqBody)) {
      const key = String(k);
      if (
        key.includes("form11") ||
        key.includes("form12") ||
        key.includes("free")
      ) {
        candidates.push(safeStr(v));
      }
    }
  }

  // 3) 最初に当たったもの
  for (const c of candidates) {
    const g = guessThemeFromText(c);
    if (g.raw) return g;
  }
  // 4) 何も無ければデフォルト
  return { theme: "love", raw: "" };
}

// pasted テキストから card_id を拾う（ゆるく対応）
function extractCardIdFromPasted(pasted) {
  const t = safeStr(pasted);

  // 例: card_id:cups_01 / card_id: major_09 / card_id=...
  const m = t.match(/card[_ -]?id\s*[:=]\s*([A-Za-z0-9_]+)/i);
  if (m && m[1]) return sanitizeId(m[1]);

  // それでも無ければ、major_XX / cups_XX っぽいものを拾う
  const m2 = t.match(/\b(major_\d{2}|cups_\d{2}|wands_\d{2}|swords_\d{2}|pentacles_\d{2})\b/i);
  if (m2 && m2[1]) return sanitizeId(m2[1]);

  return "";
}

// req.body が未パースでも動くようにする（念のため）
async function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");

  // x-www-form-urlencoded
  if (raw.includes("=") && raw.includes("&")) {
    const out = {};
    raw.split("&").forEach((pair) => {
      const [k, v] = pair.split("=");
      const key = decodeURIComponent(k || "");
      const val = decodeURIComponent((v || "").replace(/\+/g, " "));
      out[key] = val;
    });
    return out;
  }

  // json
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildText({ common, themeAdd, themeKey }) {
  // common は cards/common の1枚分
  // themeAdd は cards/theme/{theme}.json のカードID別文章（無いこともある）

  const title = common?.title || "";
  const message = common?.message || "";
  const focus = common?.focus || "";
  const action = common?.action || "";

  const add = safeStr(themeAdd || "").trim();

  // short（LINE吹き出し用）= まず theme 文章、なければ common の line.short
  const short =
    (themeAdd && safeStr(themeAdd).trim()) ||
    safeStr(common?.line?.short) ||
    `今日は「${title}」の整え。小さくでOKです🌿`;

  // long（結果ページ用）
  const long =
`🌿 今日の整えワンポイント（詳細）

【カード】${title}
${message}

【意識すること】
・${focus.split("\n").join("\n・")}

【今日の一手】
・${action.split("\n").join("\n・")}

${add ? `【テーマ別：${themeKey}】
${add}
` : ""}

🌙 焦らなくて大丈夫。整えた分だけ、現実がついてきます。`;

  return { short: short.trim(), long: long.trim() };
}

function themeLabel(theme) {
  if (theme === "money") return "金運";
  if (theme === "work") return "仕事";
  if (theme === "health") return "健康";
  return "恋愛";
}

async function writeBack(payload) {
  // Node18+ fetch
  const res = await fetch(WRITEBACK_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams(payload).toString(),
  });
  return res;
}

// ===== handler =====
module.exports = async (req, res) => {
  try {
    const body = await getBody(req);

    const uid = safeStr(body.uid || body["form_sendd"] || body["user_id"] || "").trim();
    const pasted =
      safeStr(body.pasted || body["form_data[pasted]"] || body["form11-1"] || body["form_data[form11-1]"] || "");

    // theme
    const themeInfo = extractTheme(body);
    const theme = themeInfo.theme; // love/work/money/health
    const themeRaw = themeInfo.raw;

    // cardId
    const cardIdRaw = extractCardIdFromPasted(pasted);
    const cardId = sanitizeId(cardIdRaw);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] themeRaw:", themeRaw);
    console.log("[tarot-love] theme:", theme);
    console.log("[tarot-love] pasted head:", normalizeSpace(pasted).slice(0, 80));
    console.log("[tarot-love] cardId:", cardId);

    if (!uid || !cardId) {
      // 400で落とさず、結果未保存のメッセージを保存して返す（cp21で赤枠を出せる）
      const msgShort = "まだ結果が保存されていないようです。";
      const msgLong =
        "まだ結果が保存されていないようです。\n「続き（整えワンポイント）」画面に戻り、カード結果の貼り付けとテーマ選択をして送信してください🌿";

      const [l1, l2] = splitByLimit(msgLong, FREE_LIMIT);

      await writeBack({
        uid,
        free2: msgShort,
        free5: l1,
        free6: l2,
        free3: cardId || "",
        free4: theme || "love",
      });

      return res.status(200).json({ ok: true, fallback: true });
    }

    // common json path
    const isMajor = /^major_\d{2}$/i.test(cardId);
    const commonPath = isMajor
      ? path.join(process.cwd(), "cards", "common", "major", `${cardId}.json`)
      : path.join(process.cwd(), "cards", "common", "minor", `${cardId}.json`);

    const themePath = path.join(process.cwd(), "cards", "theme", `${theme}.json`);

    console.log("[tarot-love] commonFrom:", commonPath);
    console.log("[tarot-love] themeFrom:", themePath);

    // read files
    let common;
    try {
      common = readJson(commonPath);
    } catch (e) {
      console.log("[tarot-love] ERROR common read:", e?.message || e);
      // ここでも落とさない
      common = { title: cardId, message: "カード情報の読み込みに失敗しました。", focus: "確認", action: "カードIDを見直す", line: { short: `今日は「${cardId}」の整え。小さくでOKです🌿` } };
    }

    let themeJson = {};
    try {
      themeJson = readJson(themePath);
    } catch (e) {
      console.log("[tarot-love] WARN theme read:", e?.message || e);
      themeJson = {};
    }

    // themeAdd: themeJson[cardId] があれば使う（無ければ空）
    const themeAdd = themeJson?.[cardId] || "";

    const { short, long } = buildText({
      common,
      themeAdd,
      themeKey: themeLabel(theme),
    });

    // longを free5/free6 に分割（free1は短い制限があるのでメインでは使わない）
    const [long1, long2] = splitByLimit(long, FREE_LIMIT);

    console.log("[tarot-love] len free2(short):", short.length);
    console.log("[tarot-love] len free5(long1):", long1.length);
    console.log("[tarot-love] len free6(long2):", long2.length);

    // writeBack
    const wb = await writeBack({
      uid,
      free2: short,     // 短文
      free5: long1,     // 長文1
      free6: long2,     // 長文2
      free3: cardId,    // デバッグ用
      free4: theme,     // デバッグ用
    });

    console.log("[tarot-love] writeBack status:", wb.status);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.log("[tarot-love] FATAL:", e);
    // ここでも 200 で返す（ProLine側の動作を止めない）
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
