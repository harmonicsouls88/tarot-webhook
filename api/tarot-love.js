// api/tarot-love.ts

function pickCardId(pasted: string) {
  const m = pasted.match(/card_id\s*:\s*([A-Za-z0-9_]+)/);
  return m?.[1] ?? "";
}

/** ProLine で form-urlencoded / text で来ても拾えるようにする */
function getBodyValue(req: any, key: string): string {
  const b = req.body;
  if (!b) return "";

  // すでに object の場合
  if (typeof b === "object") {
    const v = b[key];
    return typeof v === "string" ? v : "";
  }

  // string の場合（form-urlencoded など）
  if (typeof b === "string") {
    try {
      const params = new URLSearchParams(b);
      return params.get(key) ?? "";
    } catch {
      return "";
    }
  }

  return "";
}

export default async function handler(req: any, res: any) {
  const uid =
    (req.body?.uid as string) ||
    (req.query?.uid as string) ||
    getBodyValue(req, "uid") ||
    "";

  const pasted =
    (req.query?.pasted as string) ||
    getBodyValue(req, "form11-1") ||
    getBodyValue(req, "form12-1") ||
    getBodyValue(req, "pasted") ||
    "";

  const cardId = pickCardId(pasted);

  console.log("uid:", uid);
  console.log("pasted:", pasted);
  console.log("cardId:", cardId);

  return res.status(200).json({ ok: true, uid, cardId });
}
