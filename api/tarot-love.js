// api/tarot-love.js
const qs = require("querystring");
const fs = require("fs");
const path = require("path");

function pickCardId(text) {
  if (!text) return "";
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

// Node18+ なら fetch が使えます（Vercel OK）
async function postFormUrlEncoded(url, dataObj) {
  const body = qs.stringify(dataObj);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await r.text();
  return { status: r.status, body: text };
}

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function buildCp21Url(uid) {
  // あなたの cp21 のID（bYnEXcWDaC の部分）を env にしておくのが一番きれい
  // まだ無いなら直書きでもOK
  const CP21_ID = process.env.PROLINe_CP21_ID || "bYnEXcWDaC"; // ←必要なら差し替え
  return `https://l8x1uh5r.autosns.app/cp/${CP21_ID}?uid=${encodeURIComponent(uid)}`;
}

function loadCardText(cardId) {
  // cards/major_19.txt みたいに置いておく想定
  const p = path.join(process.cwd(), "cards", `${cardId}.txt`);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8").trim();
}

module.exports = async (req, res) => {
  try {
    // ==== 1) uid / pasted を回収 ====
    const uid =
      (req.query && req.query.uid) ||
      (req.body && req.body.uid) ||
      "";

    let pasted =
      (req.query && req.query.pasted) ||
      (req.body &&
        (req.body["form11-1"] || req.body.pasted || req.body["form12-1"])) ||
      "";

    if (!pasted && req.method === "POST") {
      const raw = await readRawBody(req);
      if (raw) {
        const parsed = qs.parse(raw);
        pasted = parsed.pasted || parsed["form11-1"] || parsed["form12-1"] || "";
      }
    }

    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) {
      return res.status(400).json({ ok: false, error: "uid is required" });
    }
    if (!cardId) {
      // card_id が取れない＝ユーザーのコピペが違う
      return res.status(200).json({
        ok: true,
        uid,
        cardId: "",
        message:
          "カード情報が見つかりませんでした🙏 送る文章に「card_id:xxxx」が入っているか確認してください。",
        cp21: buildCp21Url(uid),
      });
    }

    // ==== 2) カード本文を生成（cards/<cardId>.txt を読む想定） ====
    const cardText = loadCardText(cardId);

    if (!cardText) {
      // ここが今あなたに起きてる「カード情報なし」状態の根本
      return res.status(200).json({
        ok: true,
        uid,
        cardId,
        message:
          "今回はカード情報の取得に失敗しました🙏（カード本文データが未登録の可能性）もう一度「タロット結果」を送信してください。（同じ内容でOKです）",
        cp21: buildCp21Url(uid),
      });
    }

    const resultText = `🌿 今日の整えワンポイント\n\n${cardText}\n\n（card_id:${cardId}）`;

    // ==== 3) ProLine form12 に書き戻す ====
    const FM_BASE = getEnv("PROLINE_FM_BASE");         // 例: https://autosns.me/fm/
    const FORM12_ID = getEnv("PROLINE_FORM12_ID");     // 例: xBi34LzVvN
    const FORM12_FIELD = getEnv("PROLINE_FORM12_FIELD"); // 例: form12-1

    const writeUrl = `${FM_BASE.replace(/\/+$/, "")}/${FORM12_ID}`;
    const writeBack = await postFormUrlEncoded(writeUrl, {
      uid,
      dataType: "json",
      [FORM12_FIELD]: resultText,
    });

    console.log("[tarot-love] writeBack:", writeBack.status);

    // ==== 4) beacon を叩く（返信本文シナリオへ移動） ====
    const BEACON_ID = getEnv("PROLINE_BEACON_ID"); // 例: DyY2M1BxXN
    const beaconUrl = `https://autosns.jp/api/call-beacon/${BEACON_ID}/${encodeURIComponent(uid)}`;

    const beaconRes = await fetch(beaconUrl);
    const beaconBody = await beaconRes.text();
    console.log("[tarot-love] beacon:", beaconRes.status);

    // ==== 5) ついでに cp21 URL も返す（同時に開きたい用途） ====
    const cp21 = buildCp21Url(uid);

    return res.status(200).json({
      ok: true,
      uid,
      cardId,
      writeBack: { status: writeBack.status },
      beacon: { status: beaconRes.status, body: beaconBody },
      cp21,
    });
  } catch (e) {
    console.error("[tarot-love] error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
};
