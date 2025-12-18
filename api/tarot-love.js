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
 * cards 置き場の候補を複数試す（運用中でも崩れにくい）
 * 推奨構成:
 *   /cards/major/major_00.json
 *   /cards/minor/swords_09.json
 * もしくは
 *   /cards/major_00.json
 *   /cards/swords_09.json
 */
function loadCard(cardId) {
  const cwd = process.cwd();
  const suit = detectSuit(cardId);

  const candidates = [
    // 推奨
    path.join(cwd, "cards", "major", `${cardId}.json`),
    path.join(cwd, "cards", "minor", `${cardId}.json`),

    // 互換（フォルダ分けしてない場合）
    path.join(cwd, "cards", `${cardId}.json`),

    // さらに互換（suitごとに分けている場合）
    suit ? path.join(cwd, "cards", suit, `${cardId}.json`) : null,
  ].filter(Boolean);

  for (const p of candidates) {
    const j = readJsonIfExists(p);
    if (j) return { card: j, from: p };
  }
  return { card: null, from: candidates };
}

function buildCp21Url(uid, cardId) {
  const base = "https://l8x1uh5r.autosns.app/cp/bYnEXcWDaC";
  const q = new URLSearchParams({ uid, card_id: cardId });
  return `${base}?${q.toString()}`;
}

function buildTextForLine(cardId, card, uid) {
  // ① 大アルカナ：LINEは軽く、読むのはcp21
if (isMajor(cardId)) {
  const light =
    card?.line?.light ||
    `🌿今日はこのテーマ：${card?.cp21?.focus || card?.focus || "整え"}。`;

  const cp21 = buildCp21Url(uid, cardId);

  return [light, "", "読む（結果ページ）👇", cp21].join("\n");
}
  }

  // ② 小アルカナ：LINEで完結（実践メッセージ）
  const full = card?.line?.full;

  if (full) return full;

  // 互換：旧フォーマット（message/focus/action）から組み立て
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
  // Vercel Node Function では req.body が object / string / undefined のことがあるので吸収する
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return qs.parse(req.body);

  // bodyが取れない場合に備えてストリームから読む
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return qs.parse(raw);
}

// ProLineへ書き戻し（FM）
async function writeBackToProLine(uid, text) {
  const formId = process.env.PROLINE_FORM12_ID;      // 例: xBi34LzVvN
  const field = process.env.PROLINE_FORM12_FIELD;   // 例: user_data[free1] など（あなたが使ってる差し込み先）
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");
  if (!field) throw new Error("Missing env PROLINE_FORM12_FIELD");

  const url = `https://autosns.me/fm/${formId}`;
  const body = new URLSearchParams({
    uid,
    [field]: text,
  }).toString();

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
    // GETはテスト用（ブラウザで card_id 直接渡せる）
    if (req.method === "GET") {
      const uid = String(req.query?.uid || "test");
      const pasted = String(req.query?.pasted || "");
      const cardId = pickCardId(pasted);

      const { card, from } = loadCard(cardId);
      const text = card ? buildTextForLine(cardId, card, uid) : "";

      console.log("[tarot-love] method: GET");
      console.log("[tarot-love] uid:", uid);
      console.log("[tarot-love] pasted:", pasted);
      console.log("[tarot-love] cardId:", cardId);
      console.log("[tarot-love] cardFrom:", from);

      return res.status(200).json({ ok: true, uid, cardId, found: !!card, textPreview: text.slice(0, 120) });
    }

    // POST（ProLine）
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");
    const keys = Object.keys(body || {});
    const pasted =
      // ProLine形式: form_data[form11-1]
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form_data[form12-1]"] || "") ||
      // 互換
      String(body?.["form11-1"] || "") ||
      String(body?.["form12-1"] || "") ||
      String(body?.pasted || "");

    const cardId = pickCardId(pasted);

    console.log("[tarot-love] method:", req.method);
    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] keys:", keys);
    console.log("[tarot-love] pasted:", pasted);
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) {
      return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });
    }
    if (!cardId) {
      // card_idが無い時は “案内文” を返す（たまみ語）
      const fallback =
        "🙏 うまく読み取れませんでした。\n" +
        "フォームに貼り付ける文章に、この1行が入っているか確認してください👇\n" +
        "card_id:xxxx";

      await writeBackToProLine(uid, fallback);
      await callBeacon(uid);

      return res.status(200).json({ ok: true, uid, cardId: "", fallback: true });
    }

    const { card } = loadCard(cardId);

    if (!card) {
      const notFound =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";
      await writeBackToProLine(uid, notFound);
      await callBeacon(uid);

      return res.status(200).json({ ok: true, uid, cardId, found: false });
    }

    const text = buildTextForLine(cardId, card, uid);

    // 返信（ProLineへ書き戻し→Beacon送信）
    const writeBack = await writeBackToProLine(uid, text);
    const beacon = await callBeacon(uid);

    console.log("[tarot-love] writeBack status:", writeBack.status);
    console.log("[tarot-love] beacon status:", beacon.status);

    return res.status(200).json({
      ok: true,
      uid,
      cardId,
      writeBack,
      beacon,
    });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
