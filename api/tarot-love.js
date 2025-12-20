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

// bodyの中から「card_id:xxxx」を含む値を探す（どのフィールド名でも拾う）
function findPastedAnywhere(body) {
  for (const [k, v] of Object.entries(body || {})) {
    const s = Array.isArray(v) ? v.join("\n") : String(v ?? "");
    if (s.includes("card_id")) return { key: k, value: s };
  }
  return { key: "", value: "" };
}

// --------------------
// ProLineへ書き戻し（fm）
// --------------------
async function writeBackToProLine(formId, uid, payloadObj) {
  const fmBase = (process.env.PROLINE_FM_BASE || "https://l8x1uh5r.autosns.app/fm").replace(/\/$/, "");
  const url = `${fmBase}/${formId}`;

  const params = new URLSearchParams({ uid });
  for (const [k, v] of Object.entries(payloadObj)) {
    if (v == null) continue;
    params.set(k, String(v));
  }

  console.log("[tarot-love] writeBack POST:", url);
  console.log("[tarot-love] writeBack keys:", Object.keys(payloadObj));
  console.log("[tarot-love] writeBack body head:", params.toString().slice(0, 220));

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const text = await r.text().catch(() => "");
  return { status: r.status, url, rawSnippet: text.slice(0, 220) };
}

// --------------------
// handler
// --------------------
module.exports = async (req, res) => {
  try {
    // 動作確認
    if (req.method === "GET") {
      const uid = String(req.query?.uid || "test");
      const pasted = String(req.query?.pasted || "");
      const cardId = pickCardId(pasted);
      const { card, from } = loadCard(cardId);

      return res.status(200).json({
        ok: true,
        uid,
        cardId,
        found: !!card,
        cardFrom: from,
        shortPreview: card ? buildTextShort(cardId, card) : "",
        longPreview: card ? buildTextLong(cardId, card).slice(0, 160) : "",
      });
    }

    const body = await readBody(req);
    const uid = String(body?.uid || req.query?.uid || "");

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] body keys:", Object.keys(body || {}));

    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });

    // pastedはどのキーでも拾えるようにする
    const found = findPastedAnywhere(body);
    const pasted = found.value || "";
    const cardId = pickCardId(pasted);

    console.log("[tarot-love] pastedKey:", found.key);
    console.log("[tarot-love] cardId:", cardId);

    // === 書き戻し先ID（環境変数） ===
    const FORM11_ID = process.env.PROLINE_FORM11_ID; // form11（送信したフォーム）
    const FORM12_ID = process.env.PROLINE_FORM12_ID; // form12（結果保存用）

    if (!FORM11_ID || !FORM12_ID) {
      throw new Error("Missing env PROLINE_FORM11_ID or PROLINE_FORM12_ID");
    }

    // fp6で表示するための txt[xxxx]（あなたのHTMLに合わせて固定）
    const FP6_LONG = process.env.PROLINE_FP6_LONG_FIELD || "txt[vgbwPXeBy6]";
    const FP6_SHORT = process.env.PROLINE_FP6_SHORT_FIELD || "txt[I8onOXeYSh]";

    // cp21で表示するための form12-1 / form12-2
    const CP21_LONG = "form_data[form12-1]";
    const CP21_SHORT = "form_data[form12-2]";

    // card_idが無い → エラーメッセージを両方に書く
    if (!cardId) {
      const short =
        "🙏 うまく読み取れませんでした。\n" +
        "貼り付け文の中に「card_id:xxxx」が入っているか確認してください。";
      const long =
        short +
        "\n\n（例）\ncard_id:major_09\ncard_id:swords_07\n\nそのままコピーして貼るのが確実です🌿";

      const wb11 = await writeBackToProLine(FORM11_ID, uid, { [FP6_SHORT]: short, [FP6_LONG]: long });
      const wb12 = await writeBackToProLine(FORM12_ID, uid, { [CP21_SHORT]: short, [CP21_LONG]: long });

      return res.status(200).json({ ok: true, uid, fallback: true, writeBack11: wb11, writeBack12: wb12 });
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

      const wb11 = await writeBackToProLine(FORM11_ID, uid, { [FP6_SHORT]: short, [FP6_LONG]: long });
      const wb12 = await writeBackToProLine(FORM12_ID, uid, { [CP21_SHORT]: short, [CP21_LONG]: long });

      return res.status(200).json({ ok: true, uid, cardId, found: false, writeBack11: wb11, writeBack12: wb12 });
    }

    // ✅ 本文生成
    const shortText = buildTextShort(cardId, card);
    const longText = buildTextLong(cardId, card);

    // ✅ form11（fp6用）にも書く
    const wb11 = await writeBackToProLine(FORM11_ID, uid, {
      [FP6_SHORT]: shortText,
      [FP6_LONG]: longText,
    });

    // ✅ form12（cp21用）にも書く
    const wb12 = await writeBackToProLine(FORM12_ID, uid, {
      [CP21_SHORT]: shortText,
      [CP21_LONG]: longText,
    });

    return res.status(200).json({
      ok: true,
      uid,
      cardId,
      found: true,
      major: isMajor(cardId),
      writeBack11: wb11,
      writeBack12: wb12,
    });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
