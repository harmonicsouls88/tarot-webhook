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
  // cards json に cp21 があれば優先
  if (card?.cp21?.message) {
    const t = card.title || cardId;
    const msg = card.cp21.message || "";
    const focus = card.cp21.focus || "";
    const action = card.cp21.action || "";
    const closing = card.cp21.closing || "今日はここまでで大丈夫です🌙";

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
    ].join("\n");
  }

  // 互換（cp21が無いカード）
  const t = card?.title || cardId;
  return [
    `🌿 ${t}`,
    "",
    String(card?.message || ""),
    "",
    "【意識すること】",
    String(card?.focus || ""),
    "",
    "【今日の一手】",
    String(card?.action || ""),
    "",
    "今日はここまでで大丈夫です🌙",
  ].join("\n");
}

function buildTextForLine(cardId, card) {
  // cards json に line.full があればそれを優先（短縮/整形済み想定）
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
async function writeBackToProLine(uid, fields) {
  const formId = process.env.PROLINE_FORM12_ID; // xBi34LzVvN
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");

  const fmBase = process.env.PROLINE_FM_BASE || "https://autosns.me/fm";
  const url = `${fmBase}/${formId}`;

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
  const beaconId = process.env.PROLINE_BEACON_ID; // 例: DyY2M1BxXN
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

    if (!cardId) {
      const fallback =
        "🙏 うまく読み取れませんでした。\n" +
        "フォームに貼り付ける文章に、この1行が入っているか確認してください👇\n" +
        "card_id:xxxx";
      const lineField = process.env.PROLINE_LINE_FIELD || "free2";
      await writeBackToProLine(uid, { [lineField]: fallback });
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
      await writeBackToProLine(uid, { [lineField]: notFound });
      await callBeacon(uid);
      return res.status(200).json({ ok: true, uid, cardId, found: false });
    }

    // ✅ ProLineに入れるフィールド名（重要）
    const cp21Field = process.env.PROLINE_CP21_FIELD || "free1"; // ←「free1」
    const lineField = process.env.PROLINE_LINE_FIELD || "free2"; // ←「free2」

    const fields = {};

    // 大アルカナ：cp21（free1）に本文、LINE（free2）にも短文を入れておく
    if (isMajor(cardId)) {
      fields[cp21Field] = buildTextForCp21(cardId, card);
      fields[lineField] = buildTextForLine(cardId, card);
      console.log("[tarot-love] major writeBack ->", cp21Field, lineField);
    } else {
      // 小アルカナ：LINE完結（free2）
      fields[lineField] = buildTextForLine(cardId, card);
      console.log("[tarot-love] minor writeBack ->", lineField);
    }

    const writeBack = await writeBackToProLine(uid, fields);
    console.log("[tarot-love] writeBack:", writeBack.status, fields);

    const beacon = await callBeacon(uid);
    console.log("[tarot-love] beacon:", beacon.status);

    return res.status(200).json({ ok: true, uid, cardId, writeBack, beacon });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
