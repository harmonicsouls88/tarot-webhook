// /api/tarot-love.js

const fs = require("fs");
const path = require("path");

/**
 * pasted から card_id を抜く
 * 例: "#整え続き card_id:major_12"
 */
function pickCardId(pasted) {
  if (!pasted) return "";
  const m = String(pasted).match(/card_id\s*:\s*([A-Za-z0-9_]+)/);
  return m?.[1] ?? "";
}

/**
 * ProLineのPOST(body)から pasted を拾う
 * 実際のキーが "form_data[form11-1]" だったのがログで確認できているので最優先
 */
function pickPasted(req) {
  const b = req.body || {};
  const q = req.query || {};

  return (
    q.pasted ||
    b["form_data[form11-1]"] ||
    b["form_data[form12-1]"] ||
    b["form11-1"] ||
    b["form12-1"] ||
    b.pasted ||
    ""
  );
}

function pickUid(req) {
  const b = req.body || {};
  const q = req.query || {};
  return b.uid || q.uid || "";
}

/**
 * cards/<cardId>.json を読む
 */
function loadCard(cardId) {
  const safe = String(cardId).replace(/[^A-Za-z0-9_]/g, "");
  const file = path.join(process.cwd(), "cards", `${safe}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  return JSON.parse(raw);
}

/**
 * 表示用テキスト生成（あなたの好みに合わせて自由に整えてOK）
 */
function buildResultText(cardId, card) {
  // card側のキーはプロジェクトに合わせて調整してください
  // 例: { title, message, focus, advice } など
  const title = card?.title || card?.name || cardId;
  const message = card?.message || card?.text || "（本文が未設定です）";
  const focus = card?.focus || card?.keyword || "";
  const advice = card?.advice || card?.action || "";

  return [
    "🌿 今日の整えワンポイント",
    "",
    `【カード】${title}`,
    "",
    message,
    focus ? `\n【意識すること】${focus}` : "",
    advice ? `\n【今日の一手】${advice}` : "",
    "",
  ]
    .join("\n")
    .trim();
}

/**
 * ProLineフォーム(form12)に書き戻す
 * 期待ENV:
 *  - PROLINE_FM_BASE        例: https://autosns.me/fm
 *  - PROLINE_FORM12_ID      例: xBi34LzVvN
 *  - PROLINE_FORM12_FIELD   例: form12-1
 */
async function writeBackToForm12({ uid, text }) {
  const base = process.env.PROLINE_FM_BASE;
  const formId = process.env.PROLINE_FORM12_ID;
  const field = process.env.PROLINE_FORM12_FIELD || "form12-1";

  if (!base) throw new Error("Missing env PROLINE_FM_BASE");
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");

  const url = `${base.replace(/\/$/, "")}/${formId}`;

  // 送信形式は application/x-www-form-urlencoded が一番無難
  const params = new URLSearchParams();
  params.set("uid", uid);

  // ProLine側の受け取り揺れ対策：両方入れる（効く方が採用される）
  params.set(`form_data[${field}]`, text);
  params.set(field, text);

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const bodyText = await r.text().catch(() => "");
  return { status: r.status, bodyText };
}

/**
 * ビーコン（シナリオ移動用）を叩く（任意）
 * ENV:
 *  - PROLINE_BEACON_ID   例: DyY2M1BxXN
 * 叩くURLはあなたが使っている形式に合わせる
 */
async function callBeacon(uid) {
  const beaconId = process.env.PROLINE_BEACON_ID;
  if (!beaconId) return { skipped: true };

  const url = `https://autosns.jp/api/call-beacon/${beaconId}/${encodeURIComponent(uid)}`;
  const r = await fetch(url, { method: "GET" });
  const txt = await r.text().catch(() => "");
  return { status: r.status, bodyText: txt };
}

module.exports = async (req, res) => {
  try {
    const uid = pickUid(req);
    const pasted = pickPasted(req);
    const cardId = pickCardId(pasted);

    console.log("[tarot-love] method:", req.method);
    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] keys:", Object.keys(req.body || {}));
    console.log("[tarot-love] pasted:", pasted);
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) {
      return res.status(200).json({ ok: false, reason: "missing uid" });
    }
    if (!cardId) {
      // card_idが取れない場合も、form12にエラー文を書き戻しておくとUXが良い
      const errText =
        "🙏 card_id が見つかりませんでした。\n" +
        "送る文章にこの行が入っているか確認してください。\n" +
        "card_id:major_19（例）";

      const wb = await writeBackToForm12({ uid, text: errText });
      console.log("[tarot-love] writeBack:", wb.status);

      return res.status(200).json({ ok: false, uid, cardId: "", writeBack: wb.status });
    }

    const card = loadCard(cardId);
    let resultText;

    if (!card) {
      resultText =
        `🙏 今回はカード情報が見つかりませんでした。\n` +
        `card_id:${cardId}\n` +
        `お手数ですが、別のカードでもう一度お試しください。`;
    } else {
      resultText = buildResultText(cardId, card);
    }

    // form12へ書き戻し（c21で [[form12-1]] を表示するため）
    const wb = await writeBackToForm12({ uid, text: resultText });
    console.log("[tarot-love] writeBack status:", wb.status);

    // 必要ならビーコン（返信本文シナリオへ移動）
    const beacon = await callBeacon(uid);
    if (!beacon.skipped) {
      console.log("[tarot-love] beacon status:", beacon.status);
    }

    return res.status(200).json({
      ok: true,
      uid,
      cardId,
      writeBackStatus: wb.status,
      beaconStatus: beacon.status ?? null,
    });
  } catch (e) {
    console.error("[tarot-love] fatal:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
