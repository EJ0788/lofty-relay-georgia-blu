// api/lead-intake.ts — Minimal echo to isolate crash
import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',').map(s => s.trim()).filter(Boolean);

function setCORS(res: VercelResponse, origin?: string) {
  const allowAny = ALLOWED_ORIGINS.includes('*');
  const allowThis = origin && (allowAny || ALLOWED_ORIGINS.includes(origin));
  res.setHeader('Access-Control-Allow-Origin', allowThis ? (origin as string) : '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    setCORS(res, req.headers.origin as string);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const firstName = raw.firstName ?? raw.FirstName ?? raw.Name ?? raw.name ?? '';
    const lastName  = raw.lastName  ?? raw.LastName  ?? '';
    const email     = raw.email     ?? raw.Email     ?? '';
    const phone     = raw.phone     ?? raw.Phone     ?? '';
    const message   = raw.message   ?? raw.Message   ?? '';
    const source    = raw.source    ?? 'Website: Georgia Blu Info Form';
    const hp        = raw.hp ?? raw._honey ?? '';

    let tags: string[] = [];
    const tagsInput = raw.tags ?? raw['tags[]'];
    if (Array.isArray(tagsInput)) tags = tagsInput.map(String);
    else if (typeof tagsInput === 'string') tags = [tagsInput];

    if (hp) return res.status(200).json({ ok: true, skipped: 'honeypot' });

    return res.status(200).json({
      ok: true,
      normalized: { firstName, lastName, email, phone, message, source, tags }
    });
  } catch (err: any) {
    console.error('echo handler crash:', err);
    return res.status(500).json({ error: 'Echo crash', detail: String(err?.message || err) });
  }
}
