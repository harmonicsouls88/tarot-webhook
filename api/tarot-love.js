// /api/tarot-love.js  (CommonJS / Vercel Node)
const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");

function safeStr(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join("\n");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function readJson(filePath) {
  const p = path.resolve(filePath);
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function normalizeTheme(x) {
  const t = safeStr(x).trim().toLowerCase();
  if (["love","work","money","health"].includes(t)) return t;
  // 日本語が来た場合の救済
  if (t.includes("恋")) return "love";
  if (t.includes("仕")) return "work";
  if (t.includes("金")) return "money";
  if (t.includes("健")) return "health";
  return "";
}

function extractThemeFromPasted(pasted) {
  const s = safeStr(pasted);
  const m = s.match(/^\s*theme\s*[:=]\s*(love|work|money|health)\s*$/mi);
  return m ? m[1].toLowerCase() : "";
}

function extractCardIdFromPasted(pasted) {
  const s = safeStr(pasted);
  // card_id:xxx / cardId:xxx / card_id=xxx などを許容
  const m = s.match(/^\s*(card_id|cardId)\s*[:=]\s*([a-z_0-9]+)\s*$/mi);
  return m ? m[2] : "";
}

function cardToPaths(cardId) {
  // 期待: major_00.. / cups_01.. / wands_.. / swords_.. / pentacles_..
  const isMajor = cardId.startsWith("major_");
  const base = isMajor ? "major" : "minor";
  const commonFrom = `/var/task/cards/common/${base}/${cardId}.json`;
  return { commonFrom };
}

function httpPostForm(urlStr, formObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = new URLSearchParams();
    Object.entries(formObj).forEach(([k, v]) => body.append(k, safeStr(v)));

    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, data }));
      }
    );
    req.on("error", reject);
    req.write(body.toString());
    req.end();
  });
}

function buildTexts({ cardId, theme, commonJson, themeJson }) {
  const cardName = commonJson?.card_name || commonJson?.name || cardId;
  const oneLine  = commonJson?.one_line || commonJson?.short || "";
  const meaning  = commonJson?.meaning || commonJson?.desc || "";
  const points   = commonJson?.points || commonJson?.tips || commonJson?.bullets || [];

  const themeLine = (themeJson && themeJson[cardId]) ? themeJson[cardId] : "";

  // 短文：カード名＋一言（テーマ文は長文側へ寄せる）
  const shortText = `今日は「${cardName}」の整え。小さくでOKです🌿`;

  // 長文：テーマ文（あれば）→カード解説→意識すること→今日の一手
  let long = "";
  long += `【カード】${cardName}\n`;
  if (meaning) long += `${meaning}\n\n`;
  if (themeLine) long += `【${themeLabel(theme)}】\n${themeLine}\n\n`;

  if (Array.isArray(points) && points.length) {
    long += `【意識すること】\n`;
    points.slice(0, 10).forEach((p) => {
      const line = safeStr(p).trim();
      if (line) long += `・${line}\n`;
    });
    long += `\n`;
  }

  // 追加：一言締め（任意）
  long += `🌙 焦らなくて大丈夫。整えた分だけ、現実がついてきます。`;

  return { shortText, longText: long.trim() };
}

function themeLabel(theme){
  switch(theme){
    case "love": return "恋愛";
    case "work": return "仕事";
    case "money": return "金運";
    case "health": return "健康";
    default: return "テーマ";
  }
}

function splitLongForFree(longText) {
  // ProLine側で free1 が ~300文字前後で切れている挙動があるので、
  // free1=280文字程度 / free5=残り に分割（cp21で結合表示）
  const s = safeStr(longText);
  const LIMIT = 280;
  if (s.length <= LIMIT) return { free1: s, free5: "" };
  return { free1: s.slice(0, LIMIT), free5: s.slice(LIMIT) };
}

module.exports = async (req, res) => {
  try {
    // Vercel: req.method, req.body が来る想定
    const body = req.body || {};
    const uid = safeStr(body.uid || body["[[uid]]"] || "").trim();

    // pasted（カード貼り付け本文）
    const pasted =
      body.pasted ||
      body.text ||
      body["form_data[pasted]"] ||
      body["form_data[text]"] ||
      body["form_data[message]"] ||
      "";

    const cardId =
      safeStr(body.cardId).trim() ||
      safeStr(body.card_id).trim() ||
      extractCardIdFromPasted(pasted);

    // theme の拾い順（超重要）
    const theme =
      normalizeTheme(body.free4) ||
      normalizeTheme(body.theme) ||
      normalizeTheme(body["form_data[theme]"]) ||
      normalizeTheme(body["form_data[sel[theme]]"]) ||
      normalizeTheme(body["sel[theme]"]) ||
      extractThemeFromPasted(pasted) ||
      "love";

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] theme:", theme);
    console.log("[tarot-love] pasted head:", safeStr(pasted).slice(0, 60));
    console.log("[tarot-love] cardId:", cardId);

    if (!cardId) {
      res.status(400).send("Missing cardId");
      return;
    }

    // カード共通JSON
    const { commonFrom } = cardToPaths(cardId);
    const commonJson = readJson(commonFrom);
    console.log("[tarot-love] commonFrom:", commonFrom);

    // テーマJSON
    const themeFrom = `/var/task/cards/theme/${theme}.json`;
    const themeJson = readJson(themeFrom);
    console.log("[tarot-love] themeFrom:", themeFrom);

    // テキスト生成
    const { shortText, longText } = buildTexts({ cardId, theme, commonJson, themeJson });

    // freeへ保存（短文=free2、長文=free1、溢れ=free5）
    const { free1, free5 } = splitLongForFree(longText);

    console.log("[tarot-love] addon: yes");
    console.log("[tarot-love] len free2(short):", safeStr(shortText).length);
    console.log("[tarot-love] len free1(long):", safeStr(free1).length);
    console.log("[tarot-love] len free5(over):", safeStr(free5).length);

    // writeBack（あなたのログに出ている宛先）
    const WRITEBACK_URL = "https://l8x1uh5r.autosns.app/fm/xBi34LzVvN";
    console.log("[tarot-love] writeBack POST:", WRITEBACK_URL);

    // ここは ProLine側のフィールドキーに合わせる（free1/free2/free3/free4/free5）
    // ※あなたのログに "writeBack keys: ['free2','free1','free3','free4',...]" が出ているのでOK
    const payload = {
      uid: uid,
      free2: shortText,     // 短文
      free1: free1,         // 長文（先頭）
      free5: free5,         // 長文の続き（あれば）
      free3: cardId,        // デバッグ: cardId保持
      free4: theme          // デバッグ: theme保持（次回も確認できる）
    };

    const r = await httpPostForm(WRITEBACK_URL, payload);
    console.log("[tarot-love] writeBack status:", r.status);

    res.status(200).json({ ok: true, theme, cardId, writeBackStatus: r.status });
  } catch (e) {
    console.log("[tarot-love] ERROR:", e && e.stack ? e.stack : e);
    res.status(500).send("Internal Error");
  }
};
