// api/tarot-love.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

function pickCardId(pasted: string) {
  const m = pasted.match(/card_id\s*:\s*([A-Za-z0-9_]+)/);
  return m?.[1] ?? "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ProLineは form-urlencoded で来ることが多いので req.body が object になってる想定
  const uid =
    (req.body?.uid as string) ||
    (req.query?.uid as string) ||
    "";

  // pastedの取り方：query → form11-1 → pasted の順で拾う（保険多め）
  const pasted =
    (req.query?.pasted as string) ||
    (req.body?.["form11-1"] as string) ||
    (req.body?.["form12-1"] as string) ||
    (req.body?.pasted as string) ||
    "";

  const cardId = pickCardId(pasted);

  console.log("uid:", uid);
  console.log("pasted:", pasted);
  console.log("cardId:", cardId);

  return res.status(200).json({ ok: true, uid, cardId });
}
