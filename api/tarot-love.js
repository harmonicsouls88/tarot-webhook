// /api/tarot-love.js
const fs = require("fs");
const path = require("path");
const qs = require("querystring");

// --------------------
// helpers
// --------------------
function pickCardId(pasted) {
  if (!pasted) return "";
  // 例: "card_id:major_16" / "card_id = wands_01"
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
 * 推奨:
 *   /cards/major/major_00.json
 *   /cards/minor/swords_09.json
 * 互換:
 *   /cards/major_00.json
 *   /cards/swords_09.json
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

/**
 * ProLineの「友だちごとの自由フィールド」は fm へ送るキーが
 *   user_data[free1] / user_data[xtarot_message]
 * のような形になります。
 *
 * 環境変数で
 *   free1
 *   user_data[free1]
 * どちらが来ても動くように正規化します。
 */
function normalizeUserDataKey(maybeKey, fallbackKey) {
  const raw = String(maybeKey || "").trim();
  const fb = String(fallbackKey || "").trim();

  const v = raw || fb;

  // すでに user_data[xxx] 形式ならそのまま
  if (v.includes("[") && v.includes("]")) return v;

  // "free1" / "free2" / "xtarot_message" などは user_data[...] に包む
  return `user_data[${v}]`;
}

function buildCp21Url(uid, cardId) {
  const base = "https://l8x1uh5r.autosns.app/cp/bYnEXcWDaC";
  const p = new URLSearchParams();
  if (uid) p.set("uid", uid);
  if (cardId) p.set("card_id", cardId); // 必要なら
  return `${base}?${p.toString()}`;
}

function buildTextForLine(cardId, card) {
  // JSONに line.full があれば最優先
  const full = card?.line?.full;
  if (full) return String(full);

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
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTextForCp21(card) {
  return [
    `🌿 ${card.title || ""}`.trim(),
    "",
    card.message || "",
    "",
    "【意識すること】",
    card.focus || "",
    "",
    "【今日の一手】",
    card.action || "",
    "",
    "今日はここまでで大丈夫です🌙",
  ].join("\n");
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
// --------------------
async function writeBackToProLine(uid, payloadObj) {
  const formId = process.env.PROLINE_FORM12_ID; // 書き戻し用フォームID
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");

  // ✅ fm は /fm が必須のケースがあるので、ここは「/fm入り」を推奨
  const fmBase = process.env.PROLINE_FM_BASE || "https://l8x1uh5r.autosns.app/fm";
  const url = `${fmBase.replace(/\/$/, "")}/${formId}`;

  // uid + 複数フィールドを一括で送る
  const params = new URLSearchParams({ uid });
  for (const [k, v] of Object.entries(payloadObj)) {
    if (v == null) continue;
    params.set(k, String(v));
  }

  // ProLineの返りが JSON じゃなく HTML のことがあるので text で受ける
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const raw = await r.text().catch(() => "");
  return {
    status: r.status,
    url,
    rawSnippet: raw ? raw.slice(0, 260) : "",
  };
}

// --------------------
// Beaconで送信（あれば）
// --------------------
async function callBeaconIfEnabled(uid) {
  const beaconId = process.env.PROLINE_BEACON_ID;
  if (!beaconId) return { skipped: true, reason: "PROLINE_BEACON_ID not set" };

  const url = `https://autosns.jp/api/call-beacon/${beaconId}/${encodeURIComponent(uid)}`;
  const r = await fetch(url, { method: "GET" });
  const raw = await r.text().catch(() => "");
  return { status: r.status, rawSnippet: raw.slice(0, 200) };
}

// --------------------
// handler
// --------------------
module.exports = async (req, res) => {
  try {
    // GETは動作確認用
    if (req.method === "GET") {
      const uid = String(req.query?.uid || "test");
      const pasted = String(req.query?.pasted || "");
      const cardId = pickCardId(pasted);

      const { card, from } = loadCard(cardId);
      const preview = card ? buildTextForLine(cardId, card) : "";

      return res.status(200).json({
        ok: true,
        uid,
        cardId,
        found: !!card,
        cardFrom: from,
        textPreview: preview.slice(0, 140),
        cp21: buildCp21Url(uid, cardId),
      });
    }

    // POST（ProLine）
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

    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });

    // フィールドキー（環境変数が free1 でも user_data[free1] でもOKに）
    const cp21Field = normalizeUserDataKey(process.env.PROLINE_CP21_FIELD, "free1");
    const lineField = normalizeUserDataKey(process.env.PROLINE_LINE_FIELD, "free2");

    // card_idが無い
    if (!cardId) {
      const fallback =
        "🙏 うまく読み取れませんでした。\n" +
        "フォームに貼り付ける文章に、この1行が入っているか確認してください👇\n" +
        "card_id:xxxx";

      console.log("[tarot-love] writeBack keys:", [lineField]);

      const writeBack = await writeBackToProLine(uid, { [lineField]: fallback });

      // ここは好み：fallback時はビーコン不要ならコメントアウトでもOK
      const beacon = await callBeaconIfEnabled(uid);

      console.log("[tarot-love] writeBack result:", writeBack);

      return res.status(200).json({ ok: true, uid, fallback: true, writeBack, beacon });
    }

    const { card, from } = loadCard(cardId);
    console.log("[tarot-love] cardFrom:", from);

    if (!card) {
      const notFound =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";

      console.log("[tarot-love] writeBack keys:", [lineField]);

      const writeBack = await writeBackToProLine(uid, { [lineField]: notFound });
      const beacon = await callBeaconIfEnabled(uid);

      console.log("[tarot-love] writeBack result:", writeBack);

      return res.status(200).json({ ok: true, uid, cardId, found: false, writeBack, beacon });
    }

    // ✅ ここが本題：小アルカナも「free1 + free2」を両方埋める
    const cp21Text = buildTextForCp21(card);        // cp21用（深掘り）
    const lineText = buildTextForLine(cardId, card); // LINE吹き出し用（要点）

    console.log("[tarot-love] writeBack keys:", [cp21Field, lineField]);

    const writeBack = await writeBackToProLine(uid, {
      [cp21Field]: cp21Text,
      [lineField]: lineText,
    });

    console.log("[tarot-love] writeBack result:", writeBack);

    // ✅ ビーコン：重く感じるなら「小アルカナでは呼ばない」がオススメ
    let beacon = { skipped: true, reason: "minor: no beacon" };
    if (isMajor(cardId)) {
      beacon = await callBeaconIfEnabled(uid);
    }

    return res.status(200).json({ ok: true, uid, cardId, found: true, writeBack, beacon });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
