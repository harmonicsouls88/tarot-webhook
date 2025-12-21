// api/tarot-love.js (CommonJS)
// cards/common/{major|minor}/{cardId}.json を読み込んで
// cards/theme/{theme}.json の append[cardId] を追記して返す

const fs = require("fs");
const path = require("path");

// ===== ProLineの「箱」URL（ユーザーが作成済み） =====
const THEME_PAID_URL = {
  love: "https://l8x1uh5r.autosns.app/cp/gZKP8WdkE6?uid=[[uid]]",
  work: "https://l8x1uh5r.autosns.app/cp/ScBMeGwPDE?uid=[[uid]]",
  money: "https://l8x1uh5r.autosns.app/cp/mKNWGHprcf?uid=[[uid]]",
  health: "https://l8x1uh5r.autosns.app/cp/cL4HNsVwGt?uid=[[uid]]",
};

// 「有料版」等の言い方を変える（王道・軽め）
const THEME_CTA = {
  love: {
    preline: "もう一歩だけ、恋が動く整え方を受け取るなら👇",
    label: "💗 恋愛の整えガイド（通話30分）はこちら",
  },
  work: {
    preline: "仕事の流れを整える“次の一手”が欲しいなら👇",
    label: "💼 仕事の整えガイド（通話30分）はこちら",
  },
  money: {
    preline: "お金の流れを整える“次の一手”が欲しいなら👇",
    label: "💰 金運の整えガイド（通話30分）はこちら",
  },
  health: {
    preline: "体調を整える“次の一手”が欲しいなら👇",
    label: "🌿 健康の整えガイド（通話30分）はこちら",
  },
};

// ===== paths / cache =====
const ROOT = path.resolve(__dirname, "..");
const CARDS_DIR = path.join(ROOT, "cards");
const cache = new Map();

function readJson(filePath) {
  if (cache.has(filePath)) return cache.get(filePath);
  const txt = fs.readFileSync(filePath, "utf8");
  const obj = JSON.parse(txt);
  cache.set(filePath, obj);
  return obj;
}

function detectTheme(pasted) {
  const m = String(pasted || "").match(/theme\s*[:=]\s*(love|work|money|health)/i);
  return (m?.[1] || "love").toLowerCase();
}

function extractCardId(pasted) {
  const m = String(pasted || "").match(/card_id\s*[:=]\s*([A-Za-z0-9_]+)/);
  return m?.[1] || "";
}

function cardFilePath(cardId) {
  // major_00..major_21 は common/major、それ以外は common/minor
  const isMajor = /^major_\d{2}$/.test(cardId);
  const dir = isMajor ? "major" : "minor";
  return path.join(CARDS_DIR, "common", dir, `${cardId}.json`);
}

function themeFilePath(theme) {
  return path.join(CARDS_DIR, "theme", `${theme}.json`);
}

function getThemeAppend(theme, cardId) {
  try {
    const t = readJson(themeFilePath(theme));
    return String(t?.append?.[cardId] || "");
  } catch {
    return "";
  }
}

function getCtaByTheme(theme, uid) {
  const base = THEME_CTA[theme] || THEME_CTA.love;
  const urlTemplate = THEME_PAID_URL[theme] || THEME_PAID_URL.love;
  const url = urlTemplate.replace("[[uid]]", encodeURIComponent(uid || ""));
  return { ...base, url };
}

function buildTextLong(cardId, card, theme, uid) {
  // 1) 共通カード本文（line.long があるならそれ優先）
  const long = card?.line?.long;
  const title = card?.title ? `【カード】 ${card.title}` : `【カード】 ${cardId}`;
  const msg = card?.message ? String(card.message) : "";
  const focus = card?.focus ? `【意識すること】\n${String(card.focus)}` : "";
  const action = card?.action ? `【今日の一手】\n${String(card.action)}` : "";

  const base =
    long
      ? String(long)
      : [
          "🌿 今日の整えワンポイント",
          "",
          title,
          msg,
          "",
          focus,
          "",
          action,
          "",
          "今日はここまででOKです 🌙",
        ]
          .filter(Boolean)
          .join("\n");

  // 2) テーマ追記
  const append = getThemeAppend(theme, cardId);

  // 3) テーマ別CTA（言い方は“有料”を避ける）
  const cta = getCtaByTheme(theme, uid);
  const ctaBlock = cta?.url
    ? `\n\n—\n${cta.preline}\n${cta.label}\n${cta.url}`
    : "";

  return base + (append ? `\n\n${append}` : "") + ctaBlock;
}

function buildTextShort(cardId, card) {
  // form12-2（短文）に入れる想定：カード名＋1行メッセージ＋一手
  const title = card?.title ? `【${card.title}】` : `【${cardId}】`;
  const msg = card?.message ? String(card.message) : "今日は整える日。";
  const action = card?.action ? `一手：${String(card.action)}` : "";
  return [title, msg, action].filter(Boolean).join("\n");
}

// ===== ここが本体 =====
module.exports = async (req, res) => {
  try {
    const method = req.method || "GET";
    if (method !== "POST") return res.status(200).json({ ok: true, note: "POST only" });

    // ProLineからの body は object or string の可能性
    const body =
      typeof req.body === "object" && req.body
        ? req.body
        : typeof req.body === "string"
        ? parseUrlEncoded(req.body)
        : {};

    const uid = String(body.uid || "");
    const pasted =
      // form11 textarea: txt[zeRq0T9Qo1]
      body?.txt?.zeRq0T9Qo1 ||
      body?.txt?.["zeRq0T9Qo1"] ||
      body?.txt?.["zeRq0T9Qo1".toString()] ||
      body?.["txt[zeRq0T9Qo1]"] ||
      "";

    const cardId = extractCardId(pasted);
    const theme = detectTheme(pasted);

    if (!cardId) {
      // cp21で表示するためのフォールバック
      return res.status(200).json({
        ok: false,
        uid,
        theme,
        shortText: "🙏 うまく読み取れませんでした。\n貼り付け文に card_id:xxxx があるか確認してください。",
        longText: "🙏 うまく読み取れませんでした。\n貼り付け文に card_id:xxxx があるか確認してください。",
      });
    }

    const cardPath = cardFilePath(cardId);
    const card = readJson(cardPath);

    const shortText = buildTextShort(cardId, card);
    const longText = buildTextLong(cardId, card, theme, uid);

    // ProLineの「返却テキスト」に入れる想定
    // shortText -> form12-2
    // longText  -> form12-1
    return res.status(200).json({
      ok: true,
      uid,
      theme,
      cardId,
      shortText,
      longText,
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
};

// 超軽量 urlencode parser（qs不要）
function parseUrlEncoded(str) {
  const out = {};
  const s = String(str || "");
  s.split("&").forEach((kv) => {
    const [k, v] = kv.split("=");
    if (!k) return;
    const key = decodeURIComponent(k.replace(/\+/g, " "));
    const val = decodeURIComponent((v || "").replace(/\+/g, " "));
    out[key] = val;
  });
  return out;
}
