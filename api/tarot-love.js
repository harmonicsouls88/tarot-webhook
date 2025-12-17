// api/tarot-love.js  (Vercel Serverless Functions 用 / CommonJS)

function pickCardId(pasted) {
  const m = String(pasted || "").match(/card_id\s*:\s*([A-Za-z0-9_]+)/);
  return m ? m[1] : "";
}

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseFormUrlEncoded(raw) {
  const out = {};
  if (!raw) return out;
  for (const part of raw.split("&")) {
    const [k, v] = part.split("=");
    if (!k) continue;
    const key = decodeURIComponent(k.replace(/\+/g, " "));
    const val = decodeURIComponent((v || "").replace(/\+/g, " "));
    out[key] = val;
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    // 1) query
    const q = req.query || {};

    // 2) body（Vercelがパースしてくれてる場合もある）
    let body = req.body;

    // 3) bodyが無い/文字列のときは raw から復元（form-urlencoded対策）
    if (!body || typeof body === "string") {
      const raw = typeof body === "string" ? body : await readRawBody(req);
      body = parseFormUrlEncoded(raw);
    }

    const uid = body.uid || q.uid || "";
    const pasted =
      q.pasted ||
      body["form11-1"] ||   // 今あなたが送ってるのは form11-1 なので最優先
      body["form12-1"] ||
      body.pasted ||
      "";

    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] cardId:", cardId);

    return res.status(200).json({ ok: true, uid, cardId });
  } catch (e) {
    console.error("[tarot-love] error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
};
