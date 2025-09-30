// api/lead-intake.ts — normalize incoming fields (Name/Email/Phone OR firstName/email/phone)

import type { VercelRequest, VercelResponse } from '@vercel/node';

const LOFTY_API_BASE = process.env.LOFTY_API_BASE || 'https://api.lofty.com/v1.0';
const LOFTY_API_KEY  = process.env.LOFTY_API_KEY || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',').map(s => s.trim()).filter(Boolean);

const DEFAULT_SOURCE  = process.env.DEFAULT_SOURCE || 'Website: Georgia Blu Info Form';
const DEFAULT_TAGS    = (process.env.DEFAULT_TAGS || 'Georgia Blu,New Development Leads')
  .split(',').map(s => s.trim()).filter(Boolean);
const FORCE_ASSIGNEE_ID = process.env.FORCE_ASSIGNEE_ID; // optional

function setCORS(res: VercelResponse, origin?: string) {
  const allowAny = ALLOWED_ORIGINS.includes('*');
  const allowThis = origin && (allowAny || ALLOWED_ORIGINS.includes(origin));
  res.setHeader('Access-Control-Allow-Origin', allowThis ? (origin as string) : '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res, req.headers.origin as string);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (!LOFTY_API_KEY)          return res.status(500).json({ error: 'Missing LOFTY_API_KEY env var' });

  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // Accept both naming styles
    const firstName   = raw.firstName ?? raw.FirstName ?? raw.Name ?? raw.name ?? '';
    const lastName    = raw.lastName  ?? raw.LastName  ?? '';
    const email       = raw.email     ?? raw.Email     ?? '';
    const phone       = raw.phone     ?? raw.Phone     ?? '';
    const message     = raw.message   ?? raw.Message   ?? '';
    const hp          = raw.hp        ?? raw._honey    ?? ''; // honeypot (also accept _honey)
    const source      = (raw.source ?? DEFAULT_SOURCE) as string;
    const tagsInput   = raw.tags ?? raw['tags[]'] ?? [];
    const tags        = Array.isArray(tagsInput) ? tagsInput : (tagsInput ? [tagsInput] : []);

    // Bot trap
    if (hp) return res.status(200).json({ ok: true });

    if (!String(firstName).trim() || (!String(email).trim() && !String(phone).trim())) {
      return res.status(400).json({ error: 'Need firstName (or Name) and (email/Email or phone/Phone)' });
    }

    // Build Lofty payload
    const payload: Record<string, any> = {
      first_name: String(firstName).trim(),
      last_name: String(lastName || '').trim(),
      source: String(source).trim(),
      tags: [...DEFAULT_TAGS, ...tags].filter(Boolean),
      notes: message ? String(message).trim() : '',
      emails: email ? [{ address: String(email).trim(), type: 'personal' }] : [],
      phones: phone ? [{ number: String(phone).trim(), type: 'mobile' }] : []
    };
    if (FORCE_ASSIGNEE_ID) payload.assignee_id = FORCE_ASSIGNEE_ID;

    const r = await fetch(`${LOFTY_API_BASE}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `token ${LOFTY_API_KEY}` },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: 'Lofty API error', detail: text });

    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    return res.status(200).json({ ok: true, loftyLeadId: data?.id || null });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error', detail: String(err?.message || err) });
  }
}
