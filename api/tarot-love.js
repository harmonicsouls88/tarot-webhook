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

function buildTextForCp21(card) {
  return [
    `🌿 ${card.title || ""}`.trim(),
    "",
    String(card.message || ""),
    "",
    "【意識すること】",
    String(card.focus || ""),
    "",
    "【今日の一手】",
    String(card.action || ""),
    "",
    "今日はここまでで大丈夫です🌙",
  ].join("\n").trim();
}

function buildTextForLine(cardId, card) {
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
// ProLineへ書き戻し（FM）
// ★重要：必ずあなたのサブドメイン側にPOSTする
// --------------------
async function writeBack(uid, payloadObj) {
  const fmBase = process.env.PROLINE_FM_BASE;          // 例: https://l8x1uh5r.autosns.app/fm
  const formId = process.env.PROLINE_FORM12_ID;        // 例: xBi34LzVvN
  if (!fmBase) throw new Error("Missing env PROLINE_FM_BASE");
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");

  const url = `${fmBase}/${formId}`;

  const body = new URLSearchParams({ uid, ...payloadObj }).toString();

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json };
}

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
    const body = req.method === "GET" ? (req.query || {}) : await readBody(req);

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

    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });
    if (!cardId) {
      const fallback =
        "🙏 うまく読み取れませんでした。\n" +
        "フォームに貼り付ける文章に、この1行が入っているか確認してください👇\n" +
        "card_id:xxxx";
      await writeBack(uid, { free2: fallback });
      await callBeacon(uid);
      return res.status(200).json({ ok: true, uid, cardId: "", fallback: true });
    }

    const { card, from } = loadCard(cardId);
    console.log("[tarot-love] cardFrom:", from);

    if (!card) {
      const notFound =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";
      await writeBack(uid, { free2: notFound });
      await callBeacon(uid);
      return res.status(200).json({ ok: true, uid, cardId, found: false });
    }

    const cp21Text = buildTextForCp21(card);
    const lineText = buildTextForLine(cardId, card);

    // 大アルカナは free1（cp21本文）もセット、通常は free2（LINE本文）だけでもOK
    const payload = isMajor(cardId)
      ? { free1: cp21Text, free2: lineText }
      : { free2: lineText };

    const writeBackRes = await writeBack(uid, payload);
    const beacon = await callBeacon(uid);

    console.log("[tarot-love] writeBack:", writeBackRes.status, payload);
    console.log("[tarot-love] beacon:", beacon.status);

    return res.status(200).json({ ok: true, uid, cardId, writeBackRes, beacon });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
