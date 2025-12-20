// /api/tarot-love.js
const fs = require("fs");
const path = require("path");
const qs = require("querystring");

// --------------------
// helpers
// --------------------
function pickCardId(text) {
  if (!text) return "";
  const m = String(text).match(/card_id\s*[:=]\s*([A-Za-z0-9_]+)/);
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

function buildTextShort(cardId, card) {
  const short = card?.line?.short;
  if (short) return String(short);

  const full = card?.line?.full;
  if (full) return String(full).slice(0, 120);

  const title = card?.title || cardId;
  const focus = card?.focus ? `意識：${String(card.focus)}` : "";
  const action = card?.action ? `一手：${String(card.action)}` : "";

  return [`【${title}】`, focus, action].filter(Boolean).join("\n");
}

function buildTextLong(cardId, card) {
  const long = card?.line?.long;
  if (long) return String(long);

  const title = card?.title ? `【カード】${card.title}` : `【カード】${cardId}`;
  const msg = card?.message ? String(card.message) : "";
  const focus = card?.focus ? `【意識すること】\n${String(card.focus)}` : "";
  const action = card?.action ? `【今日の一手】\n${String(card.action)}` : "";

  return [
    "🌿 今日の整えワンポイント",
    "",
    title,
    msg,
    "",
    focus,
    "",
    action,
    "",
    "今日はここまででOKです🌙",
  ]
    .filter(Boolean)
    .join("\n");
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return qs.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return qs.parse(raw);
}

/**
 * ProLineから来た body の中で、card_id を含むテキストを自動で探す
 * （どのフォーム項目に入って来ても拾えるようにする）
 */
function findTextContainingCardId(body) {
  if (!body || typeof body !== "object") return "";

  // よくあるキーを優先
  const preferredKeys = [
    "pasted",
    "text",
    "message",
    "form_data[form11-1]",
    "form11-1",
    "form_data[form12-1]",
    "form12-1",
  ];

  for (const k of preferredKeys) {
    const v = body?.[k];
    if (typeof v === "string" && v.includes("card_id")) return v;
  }

  // 全キー走査：どれかに card_id が入っていればそれを採用
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === "string" && v.includes("card_id")) {
      return v;
    }
  }

  return "";
}

// --------------------
// ProLineへ書き戻し（fm）
// ※ form12 の textarea name が txt[xxxxx] 形式なので、それに合わせる
// --------------------
async function writeBackToProLine(uid, payloadObj) {
  const formId = process.env.PROLINE_FORM12_ID; // xBi34LzVvN
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");

  const fmBase = (process.env.PROLINE_FM_BASE || "https://l8x1uh5r.autosns.app/fm").replace(/\/$/, "");
  const url = `${fmBase}/${formId}`;

  // ✅ あなたの form HTML から確定した name
  // 長文：txt[vgbwPXeBy6]
  // 短文：txt[I8onOXeYSh]
  const LONG_FIELD = process.env.PROLINE_FORM12_LONG_FIELD || "txt[vgbwPXeBy6]";
  const SHORT_FIELD = process.env.PROLINE_FORM12_SHORT_FIELD || "txt[I8onOXeYSh]";

  const params = new URLSearchParams({ uid, dataType: "json" }); // PHPサンプルと同様に dataType=json を付ける
  params.set(SHORT_FIELD, String(payloadObj.short ?? ""));
  params.set(LONG_FIELD, String(payloadObj.long ?? ""));

  console.log("[tarot-love] writeBack POST:", url);
  console.log("[tarot-love] writeBack keys:", [SHORT_FIELD, LONG_FIELD]);
  console.log("[tarot-love] writeBack body head:", params.toString().slice(0, 240));

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const text = await r.text().catch(() => "");
  return {
    status: r.status,
    url,
    rawSnippet: text.slice(0, 220),
  };
}

// --------------------
// handler
// --------------------
module.exports = async (req, res) => {
  try {
    // GETは動作確認用（ブラウザで叩く）
    if (req.method === "GET") {
      const uid = String(req.query?.uid || "test");
      const pasted = String(req.query?.pasted || "");
      const cardId = pickCardId(pasted);

      const { card, from } = loadCard(cardId);
      return res.status(200).json({
        ok: true,
        uid,
        pasted,
        cardId,
        found: !!card,
        cardFrom: from,
        shortPreview: card ? buildTextShort(cardId, card) : "",
        longPreview: card ? buildTextLong(cardId, card).slice(0, 160) : "",
      });
    }

    // POST（ProLine）
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");
    const pasted = findTextContainingCardId(body); // ✅ 自動探索
    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] pasted(head):", String(pasted || "").slice(0, 180));
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });

    // card_idが無い
    if (!cardId) {
      const short =
        "🙏 うまく読み取れませんでした。\n" +
        "貼り付け文の中に「card_id:xxxx」が入っているか確認してください。";
      const long =
        short +
        "\n\n（例）\ncard_id:major_09\ncard_id:swords_07\n\nそのままコピーして貼るのが確実です🌿";

      const writeBack = await writeBackToProLine(uid, { short, long });
      return res.status(200).json({ ok: true, uid, fallback: true, writeBack });
    }

    const { card, from } = loadCard(cardId);
    console.log("[tarot-love] cardFrom:", from);

    if (!card) {
      const short =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";
      const long =
        short +
        "\n\n（原因例）\n・途中で文章が欠けた\n・card_idの行が消えた\n・余計な改行が入った";

      const writeBack = await writeBackToProLine(uid, { short, long });
      return res.status(200).json({ ok: true, uid, cardId, found: false, writeBack });
    }

    const shortText = buildTextShort(cardId, card);
    const longText = buildTextLong(cardId, card);

    const writeBack = await writeBackToProLine(uid, { short: shortText, long: longText });

    return res.status(200).json({
      ok: true,
      uid,
      cardId,
      found: true,
      major: isMajor(cardId),
      writeBack,
    });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
