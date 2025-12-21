// /api/tarot-love.js  (ESM版：package.json が "type":"module" 前提)
import fs from "node:fs";
import path from "node:path";
import qs from "node:querystring";

// --------------------
// helpers
// --------------------
function pickCardId(pasted) {
  if (!pasted) return "";
  const m = String(pasted).match(/card_id\s*[:=]\s*([A-Za-z0-9_]+)/);
  return m?.[1] ?? "";
}

function detectTheme(pasted, body = {}) {
  // 1) フォームのラジオ値（sel[theme]）を最優先
  const selTheme =
    body?.["sel[theme]"] ||
    body?.sel?.theme ||
    body?.theme ||
    "";

  if (typeof selTheme === "string" && selTheme) {
    const t = selTheme.trim().toLowerCase();
    if (["love", "work", "money", "health"].includes(t)) return t;
  }

  // 2) pasted 先頭行 theme:love を見る（あなたの仕様）
  const s = String(pasted || "");
  const m = s.match(/^\s*theme\s*[:=]\s*(love|work|money|health)\s*$/im);
  if (m?.[1]) return m[1];

  // 3) 日本語にも一応対応（保険）
  if (/(恋愛|恋|love)/i.test(s)) return "love";
  if (/(仕事|work)/i.test(s)) return "work";
  if (/(金運|money)/i.test(s)) return "money";
  if (/(健康|health)/i.test(s)) return "health";

  // デフォルト
  return "love";
}

function isMajor(cardId) {
  return /^major_\d{2}$/.test(cardId);
}

function readJsonIfExists(p) {
  if (!p) return null;
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function deepMerge(base, override) {
  if (!base) return override;
  if (!override) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === "object" &&
      !Array.isArray(base[k])
    ) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// --------------------
// CTA（テーマ別リンク）
// ユーザーが作った箱URL（[[uid]]差し替え）
// --------------------
const CTA_BY_THEME = {
  love: {
    preline: "💗 もう一歩だけ、関係を整えたい方へ（個別チェック）",
    label: "恋愛の整えチェックへ",
    urlTpl: "https://l8x1uh5r.autosns.app/cp/gZKP8WdkE6?uid=[[uid]]",
  },
  work: {
    preline: "💼 次の一手を“決めきる”ための個別チェック",
    label: "仕事の整えチェックへ",
    urlTpl: "https://l8x1uh5r.autosns.app/cp/ScBMeGwPDE?uid=[[uid]]",
  },
  money: {
    preline: "💰 お金の流れを整える“個別チェック”",
    label: "金運の整えチェックへ",
    urlTpl: "https://l8x1uh5r.autosns.app/cp/mKNWGHprcf?uid=[[uid]]",
  },
  health: {
    preline: "🫧 体と気持ちを整える“個別チェック”",
    label: "健康の整えチェックへ",
    urlTpl: "https://l8x1uh5r.autosns.app/cp/cL4HNsVwGt?uid=[[uid]]",
  },
};

function buildCtaBlock(theme, uid) {
  const cta = CTA_BY_THEME[theme] || CTA_BY_THEME.love;
  const url = String(cta.urlTpl).replace("[[uid]]", encodeURIComponent(uid || ""));
  return `\n\n───\n${cta.preline}\n👉 ${cta.label}\n${url}`;
}

// --------------------
// カード読み込み：共通→テーマ上書き（A案：フォルダで分ける）
// 例）
//   cards/common/major/major_00.json
//   cards/themes/love/major/major_00.json  ←あれば上書き
//
// ただし、現状のあなたの配置（cards/major や cards/minor直下）も
// そのまま読めるように「互換候補」も入れています。
// --------------------
function loadCard(cardId, theme) {
  const cwd = process.cwd();

  const isMaj = isMajor(cardId);
  const kind = isMaj ? "major" : "minor";

  const commonCandidates = [
    // 推奨（今後の共通置き場）
    path.join(cwd, "cards", "common", kind, `${cardId}.json`),

    // 互換：いま既にある構造
    path.join(cwd, "cards", kind, `${cardId}.json`),      // cards/major/xxx.json or cards/minor/xxx.json
    path.join(cwd, "cards", `${cardId}.json`),            // cards/xxx.json
  ];

  const themeCandidates = [
    // 推奨（テーマ差分の置き場）
    path.join(cwd, "cards", "themes", theme, kind, `${cardId}.json`),

    // 互換：テーマ直下に置いた場合も拾えるように
    path.join(cwd, "cards", theme, kind, `${cardId}.json`),
    path.join(cwd, "cards", theme, `${cardId}.json`),
  ];

  const common = commonCandidates.map(readJsonIfExists).find(Boolean) || null;
  const themed = themeCandidates.map(readJsonIfExists).find(Boolean) || null;

  const merged = deepMerge(common, themed);
  const from = {
    theme,
    commonTried: commonCandidates,
    themeTried: themeCandidates,
    usedCommon: !!common,
    usedTheme: !!themed,
  };

  return { card: merged || null, from };
}

function buildTextShort(cardId, card) {
  const short = card?.line?.short;
  if (short) return String(short);

  const title = card?.title || cardId;
  const focus = card?.focus ? `意識：${String(card.focus)}` : "";
  const action = card?.action ? `一手：${String(card.action)}` : "";
  return [`【${title}】`, focus, action].filter(Boolean).join("\n");
}

function buildTextLong(cardId, card, theme, uid) {
  const long = card?.line?.long;
  const base = long
    ? String(long)
    : [
        "🌿 今日の整えワンポイント",
        "",
        card?.title ? `【カード】${card.title}` : `【カード】${cardId}`,
        card?.message ? String(card.message) : "",
        "",
        card?.focus ? `【意識すること】\n${String(card.focus)}` : "",
        "",
        card?.action ? `【今日の一手】\n${String(card.action)}` : "",
        "",
        "今日はここまででOKです🌙",
      ]
        .filter(Boolean)
        .join("\n");

  // 末尾にテーマ別CTA
  return base + buildCtaBlock(theme, uid);
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
// ProLineへ書き戻し（fm）
// form12-1（長文）/ form12-2（短文）へ入れる
// --------------------
async function writeBackToProLine(uid, payloadObj) {
  const formId = process.env.PROLINE_FORM12_ID;
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");

  const fmBase = (process.env.PROLINE_FM_BASE || "https://l8x1uh5r.autosns.app/fm").replace(/\/$/, "");
  const url = `${fmBase}/${formId}`;

  const params = new URLSearchParams({ uid });
  for (const [k, v] of Object.entries(payloadObj)) {
    if (v == null) continue;
    params.set(k, String(v));
  }

  console.log("[tarot-love] writeBack POST:", url);
  console.log("[tarot-love] writeBack keys:", Object.keys(payloadObj));

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const text = await r.text().catch(() => "");
  return { status: r.status, url, rawSnippet: text.slice(0, 220) };
}

// --------------------
// handler
// --------------------
export default async function handler(req, res) {
  try {
    // GETは動作確認用
    if (req.method === "GET") {
      const uid = String(req.query?.uid || "test");
      const pasted = String(req.query?.pasted || "");
      const theme = detectTheme(pasted, req.query || {});
      const cardId = pickCardId(pasted);
      const { card, from } = loadCard(cardId, theme);

      return res.status(200).json({
        ok: true,
        uid,
        theme,
        cardId,
        found: !!card,
        cardFrom: from,
        shortPreview: card ? buildTextShort(cardId, card) : "",
        longPreview: card ? buildTextLong(cardId, card, theme, uid).slice(0, 220) : "",
      });
    }

    // POST（ProLine）
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");
    const pasted =
      String(body?.["txt[zeRq0T9Qo1]"] || "") || // form11の貼り付け欄
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form_data[form12-1]"] || "") ||
      String(body?.["form11-1"] || "") ||
      String(body?.["form12-1"] || "") ||
      String(body?.pasted || "");

    const theme = detectTheme(pasted, body);
    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] theme:", theme);
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });

    // card_idが無い
    if (!cardId) {
      const short =
        "🙏 うまく読み取れませんでした。\n貼り付け文の中に「card_id:xxxx」が入っているか確認してください。";
      const long =
        short +
        "\n\n（例）\n" +
        "theme:love\ncard_id:major_09\n\n" +
        "theme:work\ncard_id:swords_07\n\n" +
        "そのままコピーして貼るのが確実です🌿";

      const writeBack = await writeBackToProLine(uid, {
        "form_data[form12-2]": short,
        "form_data[form12-1]": long,
      });

      return res.status(200).json({ ok: true, uid, theme, fallback: true, writeBack });
    }

    const { card, from } = loadCard(cardId, theme);
    console.log("[tarot-love] cardFrom:", from);

    if (!card) {
      const short =
        "🙏 カード情報が見つかりませんでした。\nもう一度引き直して、表示された文章をそのまま貼り付けてください🌿";
      const long =
        short +
        "\n\n（原因例）\n・途中で文章が欠けた\n・card_idの行が消えた\n・余計な改行が入った";

      const writeBack = await writeBackToProLine(uid, {
        "form_data[form12-2]": short,
        "form_data[form12-1]": long,
      });

      return res.status(200).json({ ok: true, uid, theme, cardId, found: false, writeBack });
    }

    // ✅ form12-1 / form12-2 に保存
    const shortText = buildTextShort(cardId, card);
    const longText = buildTextLong(cardId, card, theme, uid);

    const writeBack = await writeBackToProLine(uid, {
      "form_data[form12-2]": shortText,
      "form_data[form12-1]": longText,
    });

    return res.status(200).json({ ok: true, uid, theme, cardId, found: true, major: isMajor(cardId), writeBack });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}
