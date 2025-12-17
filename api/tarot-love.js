// api/tarot-love.js

const qs = require("querystring");

function pickCardId(text) {
  if (!text) return "";
  // 例: "card_id:swords_14" / "card_id: major_19" / "card_id :major_19"
  const m = String(text).match(/card_id\s*:\s*([A-Za-z0-9_]+)/i);
  return m ? m[1] : "";
}

function readRawBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

module.exports = async (req, res) => {
  try {
    // --- uid ---
    const uid =
      (req.query && req.query.uid) ||
      (req.body && req.body.uid) ||
      "";

    // --- pasted（保険多め：query → form11-1 → pasted → form12-1）---
    let pasted =
      (req.query && req.query.pasted) ||
      (req.body && (req.body["form11-1"] || req.body.pasted || req.body["form12-1"])) ||
      "";

    // body が object じゃないケース（ProLineが urlencoded で来る）を拾う
    if (!pasted && req.method === "POST") {
      const raw = await readRawBody(req);
      if (raw) {
        const parsed = qs.parse(raw);
        pasted = parsed.pasted || parsed["form11-1"] || parsed["form12-1"] || "";
      }
    }

    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] pasted:", pasted);
    console.log("[tarot-love] cardId:", cardId);

    // まずはここで 200 を返して動作確認（後で writeBack / beacon を足す）
    return res.status(200).json({ ok: true, uid, cardId });
  } catch (e) {
    console.error("[tarot-love] error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
};
