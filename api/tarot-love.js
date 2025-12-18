// /api/tarot-love.js
const { URLSearchParams } = require("url");

function extractCardId(text = "") {
  // card_id:major_19 / card_id: wands_06 / card_id : wands_06 みたいな揺れ全部OK
  const m = String(text).match(/card_id\s*[:：]\s*([A-Za-z0-9_]+)/i);
  return m ? m[1] : "";
}

function parseBody(req) {
  // Vercelでは req.body が string のことがある
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;

  const raw = String(req.body);
  // urlencoded想定
  const params = new URLSearchParams(raw);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const body = parseBody(req);

  // まずuid
  const uid = q.uid || body.uid || "";

  // pasted候補を総当たり（どのキーで来ても拾えるように）
 const pasted =
  q.pasted ||
  body["form_data[form11-1]"] || // ← ★これが本命
  body["form_data[form12-1]"] || // 保険
  body["form11-1"] ||            // 保険
  body["form12-1"] ||            // 保険
  body.pasted ||
  "";

  const cardId = extractCardId(pasted);

  // デバッグ用：どのキーで届いているか確認できる
  console.log("[tarot-love] method:", req.method);
  console.log("[tarot-love] uid:", uid);
  console.log("[tarot-love] keys:", Object.keys(body));
  console.log("[tarot-love] pasted:", pasted);
  console.log("[tarot-love] cardId:", cardId);

  res.status(200).json({ ok: true, uid, cardId });
};
