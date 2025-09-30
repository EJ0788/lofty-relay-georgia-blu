// /api/lead-intake.ts — Georgia Blu relay to Lofty
import type { VercelRequest, VercelResponse } from '@vercel/node';

const LOFTY_API_BASE = process.env.LOFTY_API_BASE || 'https://api.lofty.com/v1.0';
const LOFTY_API_KEY  = process.env.LOFTY_API_KEY;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s=>s.trim()).filter(Boolean);

const DEFAULT_SOURCE  = process.env.DEFAULT_SOURCE || 'Website: Georgia Blu Info Form';
const DEFAULT_TAGS    = (process.env.DEFAULT_TAGS || 'Georgia Blu,New Development Leads')
  .split(',')
  .map(s=>s.trim())
  .filter(Boolean);

const FORCE_ASSIGNEE_ID = process.env.FORCE_ASSIGNEE_ID; // optional

function setCORS(res: VercelResponse, origin?: string) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || '*';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res, req.headers.origin as string);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!LOFTY_API_KEY) return res.status(500).json({ error: 'Missing LOFTY_API_KEY env var' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { firstName, lastName, email, phone, message, marketingOptIn, hp, source, tags } = body;

    if (hp) return res.status(200).json({ ok: true }); // bot trap
    if (!firstName || (!email && !phone)) {
      return res.status(400).json({ error: 'Need firstName and (email or phone)' });
    }

    const payload: Record<string, any> = {
      first_name: String(firstName).trim(),
      last_name: String(lastName || '').trim(),
      source: String(source || DEFAULT_SOURCE).trim(),
      tags: [...DEFAULT_TAGS, ...(Array.isArray(tags) ? tags : [])].filter(Boolean),
      notes: message ? String(message).trim() : '',
      marketing_opt_in: !!marketingOptIn,
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
