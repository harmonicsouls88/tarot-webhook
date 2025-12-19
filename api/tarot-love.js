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

function buildTextForCp21(cardId, card) {
  const title = card?.title || cardId;
  const msg = (card?.cp21?.message ?? card?.message ?? "").trim();
  const focus = (card?.cp21?.focus ?? card?.focus ?? "").trim();
  const action = (card?.cp21?.action ?? card?.action ?? "").trim();
  const closing = (card?.cp21?.closing ?? "今日はここまでで大丈夫です🌙").trim();

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

function buildTextForLine(cardId, card) {
  // もしカードJSON側に line.full があればそれを優先
  const full = card?.line?.full;
  if (full) return String(full);

  const title = card?.title ? `【カード】${card.title}` : `【カード】${cardId}`;
  const msg = card?.message ? String(card.message) : "";
  const focus = card?.focus ? `【意識すること】\n${card.focus}` : "";
  const action = card?.action ? `【今日の一手】\n${card.action}` : "";

  return [
    "🌿 今日の整えワンポイント",
    "",
    title,
    msg,
    "",
    focus,
    "",
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

// ProLineへ書き戻し（FM）
async function writeBack(uid, fields) {
  const formId = process.env.PROLINE_FORM12_ID;
  const fmBase = process.env.PROLINE_FM_BASE || "https://autosns.me/fm";
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");

  const url = `${fmBase.replace(/\/$/, "")}/${formId}`;

  const body = new URLSearchParams({ uid, ...fields }).toString();

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json };
}

// Beaconで送信
async function callBeacon(uid) {
  const beaconId = process.env.PROLINE_BEACON_ID;
  if (!beaconId) throw new Error("Missing env PROLINE_BEACON_ID");

  const url = `https://autosns.jp/api/call-beacon/${beaconId}/${encodeURIComponent(uid)}`;
  const r = await fetch(url, { method: "GET" });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json };
}

// --------------------
// handler
// --------------------
module.exports = async (req, res) => {
  try {
    // POST（ProLine）
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");
    const pasted =
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form11-1"] || "") ||
      String(body?.pasted || "");

    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] pasted:", pasted);
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });

    // card_idが無いとき
    if (!cardId) {
      const fallback =
        "🙏 うまく読み取れませんでした。\n" +
        "フォームに貼り付ける文章に、この1行が入っているか確認してください👇\n" +
        "card_id:xxxx";
      const lineField = process.env.PROLINE_LINE_FIELD || "free2";
      await writeBack(uid, { [lineField]: fallback });
      await callBeacon(uid);
      return res.status(200).json({ ok: true, uid, cardId: "", fallback: true });
    }

    const { card, from } = loadCard(cardId);
    console.log("[tarot-love] cardFrom:", from);

    if (!card) {
      const notFound =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";
      const lineField = process.env.PROLINE_LINE_FIELD || "free2";
      await writeBack(uid, { [lineField]: notFound });
      await callBeacon(uid);
      return res.status(200).json({ ok: true, uid, cardId, found: false });
    }

    // ★ 書き込み先（envで free1/free2 にしてある前提）
    const cp21Field = process.env.PROLINE_CP21_FIELD || "free1";
    const lineField = process.env.PROLINE_LINE_FIELD || "free2";

    // 大アルカナ → free1に cp21本文 を入れる（cp21表示用）
    // 小アルカナ → LINE本文だけでもOK（必要ならfree1にも入れてOK）
    const cp21Text = buildTextForCp21(cardId, card);
    const lineText = buildTextForLine(cardId, card);

    const fields = isMajor(cardId)
      ? { [cp21Field]: cp21Text, [lineField]: lineText }
      : { [lineField]: lineText };

    const write = await writeBack(uid, fields);
    const beacon = await callBeacon(uid);

    console.log("[tarot-love] writeBack:", write.status, fields);
    console.log("[tarot-love] beacon:", beacon.status);

    return res.status(200).json({ ok: true, uid, cardId, write, beacon });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
