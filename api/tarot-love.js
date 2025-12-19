// /api/tarot-love.js
const fs = require("fs");
const path = require("path");
const qs = require("querystring");

// --------------------
// helpers
// --------------------
function pickCardId(pasted) {
  if (!pasted) return "";
  const m = String(pasted).match(/card_id\s*[:=]\s*([A-Za-z0-9_]+)/);
  return m?.[1] ?? "";
}

function isMajor(cardId) {
  return /^major_\d{2}$/.test(cardId);
}

function detectSuit(cardId) {
  if (cardId.startsWith("cups_")) return "cups";
  if (cardId.startsWith("swords_")) return "swords";
  if (cardId.startsWith("wands_")) return "wands";
  if (cardId.startsWith("pentacles_")) return "pentacles";
  return "";
}

function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

/**
 * 推奨構成:
 *   /cards/major/major_00.json
 *   /cards/minor/swords_09.json
 *   /cards/minor/cups_11.json など（人物札もここに入れる）
 */
function loadCard(cardId) {
  const cwd = process.cwd();
  const suit = detectSuit(cardId);

  const candidates = [
    path.join(cwd, "cards", "major", `${cardId}.json`),
    path.join(cwd, "cards", "minor", `${cardId}.json`),
    path.join(cwd, "cards", `${cardId}.json`),
    suit ? path.join(cwd, "cards", suit, `${cardId}.json`) : null,
  ].filter(Boolean);

  for (const p of candidates) {
    const j = readJsonIfExists(p);
    if (j) return { card: j, from: p };
  }
  return { card: null, from: candidates };
}

function buildCp21Url(uid) {
  const base = "https://l8x1uh5r.autosns.app/cp/bYnEXcWDaC";
  return uid ? `${base}?uid=${encodeURIComponent(uid)}` : base;
}

function buildTextForCp21(card) {
  // cp21用：読み物として成立する「たまみ語」完成本文
  const title = card?.title || "";
  const msg = String(card?.message || "");
  const focus = String(card?.focus || "");
  const action = String(card?.action || "");
  const closing = String(card?.closing || "今日はここまでで大丈夫です🌙");

  return [
    `🌿 ${title}`,
    "",
    msg,
    "",
    "【意識すること】",
    focus,
    "",
    "【今日の一手】",
    action,
    "",
    closing,
  ].filter(Boolean).join("\n");
}

function buildLineForMajor(card, uid) {
  // LINE吹き出し：軽く
  const theme = card?.focus || "整え";
  const cp21 = buildCp21Url(uid);

  return [
    `🌿 今日はこのテーマ：${theme}`,
    "",
    "読む（結果ページ）👇",
    cp21,
  ].join("\n");
}

function buildLineForMinor(card, cardId) {
  // 小アルカナ：LINE完結（cards側で line.full があればそれを優先）
  const full = card?.line?.full;
  if (full) return full;

  const title = card?.title ? `【カード】${card.title}` : `【カード】${cardId}`;
  const msg = card?.message ? String(card.message) : "";
  const focus = card?.focus ? `【意識すること】${card.focus}` : "";
  const action = card?.action ? `【今日の一手】${card.action}` : "";

  return [
    "🌿 今日の整えワンポイント",
    "",
    title,
    msg,
    "",
    focus,
    action,
  ].filter(Boolean).join("\n");
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return qs.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return qs.parse(raw);
}

// --------------------
// ProLine writeback / beacon
// --------------------
// どの field に書くかを引数で渡せるようにする
async function writeBackToProLine(uid, field, text) {
  const formId = process.env.PROLINE_FORM12_ID; // fmの送信先（同じでOK）
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");
  if (!field) throw new Error("Missing field");

  const url = `https://autosns.me/fm/${formId}`;
  const body = new URLSearchParams({ uid, [field]: text }).toString();

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json };
}

// cp21用本文（free1）を作る：大/小どちらでもOKな形にする
function buildTextForCp21(cardId, card) {
  const t = card?.title || cardId;

  // できれば card.cp21 を優先
  const msg = (card?.cp21?.message) || card?.message || "";
  const focus = (card?.cp21?.focus) || card?.focus || "";
  const action = (card?.cp21?.action) || card?.action || "";
  const closing = (card?.cp21?.closing) || "今日はここまでで大丈夫です🌙";

  return [
    `🌿 ${t}`,
    "",
    msg,
    "",
    "【意識すること】",
    focus,
    "",
    "【今日の一手】",
    action,
    "",
    closing,
  ].filter(Boolean).join("\n");
}


// --------------------
// handler
// --------------------
module.exports = async (req, res) => {
  try {
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");
    const pasted =
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form_data[form12-1]"] || "") ||
      String(body?.["form11-1"] || "") ||
      String(body?.["form12-1"] || "") ||
      String(body?.pasted || "");

    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] pasted:", pasted);
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) {
      return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });
    }
    if (!cardId) {
      const fallback =
        "🙏 うまく読み取れませんでした。\n" +
        "フォームに貼り付ける文章に、この1行が入っているか確認してください👇\n" +
        "card_id:xxxx";
      // とりあえずLINE側（free2）に返す
      const lineField = process.env.PROLINE_LINE_FIELD;
      await writeBackToProLine(uid, lineField, fallback);
      await callBeacon(uid);
      return res.status(200).json({ ok: true, uid, cardId: "", fallback: true });
    }

    const { card, from } = loadCard(cardId);
    if (!card) {
      const notFound =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";
      const lineField = process.env.PROLINE_LINE_FIELD;
      await writeBackToProLine(uid, lineField, notFound);
      await callBeacon(uid);
      return res.status(200).json({ ok: true, uid, cardId, found: false, from });
    }

    const cp21Field = process.env.PROLINE_CP21_FIELD; // user_data[free1]
const lineField = process.env.PROLINE_LINE_FIELD; // user_data[free2]

// ① cp21用（free1）は常に書く
const cp21Text = buildTextForCp21(cardId, card);
const w1 = await writeBackToProLine(uid, cp21Field, cp21Text);

// ② LINE用（free2）はあなたの既存ロジック
const lineText = buildTextForLine(cardId, card, uid);
const w2 = await writeBackToProLine(uid, lineField, lineText);

const beacon = await callBeacon(uid);

console.log("[tarot-love] writeBack cp21:", w1.status, cp21Field);
console.log("[tarot-love] writeBack line:", w2.status, lineField);
console.log("[tarot-love] beacon:", beacon.status);
    
      return res.status(200).json({ ok: true, uid, cardId, major: true, w1, w2, beacon });
    } else {
      // 小アルカナ：LINE完結を free2 に
      const lineText = buildLineForMinor(card, cardId);
      const w2 = await writeBackToProLine(uid, lineField, lineText);
      const beacon = await callBeacon(uid);

      console.log("[tarot-love] minor from:", from);
      console.log("[tarot-love] minor writeBack line:", w2.status, lineField);
      console.log("[tarot-love] beacon:", beacon.status);

      return res.status(200).json({ ok: true, uid, cardId, major: false, w2, beacon });
    }
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
