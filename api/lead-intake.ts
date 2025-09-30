// api/lead-intake.ts — Final (camelCase → Lofty, robust)
import type { VercelRequest, VercelResponse } from '@vercel/node';

const LOFTY_API_BASE = process.env.LOFTY_API_BASE || 'https://api.lofty.com/v1.0';
const LOFTY_API_KEY  = process.env.LOFTY_API_KEY || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',').map(s => s.trim()).filter(Boolean);

const DEFAULT_SOURCE = process.env.DEFAULT_SOURCE || 'Website: Georgia Blu Info Form';
const DEFAULT_TAGS   = (process.env.DEFAULT_TAGS || 'Georgia Blu,New Development Leads')
  .split(',').map(s => s.trim()).filter(Boolean);

const FORCE_ASSIGNEE_ID = process.env.FORCE_ASSIGNEE_ID; // optional

function setCORS(res: VercelResponse, origin?: string) {
  const allowAny  = ALLOWED_ORIGINS.includes('*');
  const allowThis = origin && (allowAny || ALLOWED_ORIGINS.includes(origin));
  res.setHeader('Access-Control-Allow-Origin', allowThis ? (origin as string) : '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  Object.keys(obj).forEach(k => obj[k] === undefined && delete obj[k]);
  return obj;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res, req.headers.origin as string);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  if (!LOFTY_API_KEY) return res.status(500).json({ error: 'Missing LOFTY_API_KEY env var' });

  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    const firstName = raw.firstName ?? raw.FirstName ?? raw.Name ?? raw.name ?? '';
    const lastName  = raw.lastName  ?? raw.LastName  ?? '';
    const email     = raw.email     ?? raw.Email     ?? '';
    const phone     = raw.phone     ?? raw.Phone     ?? '';
    const message   = raw.message   ?? raw.Message   ?? '';
    const hp        = raw.hp        ?? raw._honey    ?? '';
    const source    = (raw.source ?? DEFAULT_SOURCE) as string;

    let tags: string[] = [];
    const tagsInput = raw.tags ?? raw['tags[]'];
    if (Array.isArray(tagsInput)) tags = tagsInput.map(String);
    else if (typeof tagsInput === 'string') tags = [tagsInput];

    // Honeypot → pretend success
    if (hp) return res.status(200).json({ ok: true });

    // Validate
    if (!String(firstName).trim() || (!String(email).trim() && !String(phone).trim())) {
      return res.status(400).json({ error: 'Need first name and (email or phone)' });
    }

    // Build Lofty payload (camelCase)
    const payload: Record<string, any> = stripUndefined({
      firstName: String(firstName).trim(),
      lastName:  String(lastName  || '').trim() || undefined,
      email:     String(email     || '').trim() || undefined,
      phone:     String(phone     || '').trim() || undefined,
      source:    String(source    || '').trim(),
      tags:      [...DEFAULT_TAGS, ...tags].map(s => String(s).trim()).filter(Boolean),
      notes:     message ? String(message).trim() : ''
    });
    if (FORCE_ASSIGNEE_ID) payload.assigneeId = FORCE_ASSIGNEE_ID;

    console.log('→ Lofty payload', payload);

    // Send to Lofty
    const r = await fetch(`${LOFTY_API_BASE}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Try "token", and if Lofty rejects, flip to Bearer:
        'Authorization': `token ${LOFTY_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    if (!r.ok) {
      console.error('Lofty error', text);
      return res.status(502).json({ error: 'Lofty API error', detail: text });
    }

    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    return res.status(200).json({ ok: true, loftyLeadId: data?.id ?? null });
  } catch (err: any) {
    console.error('lead-intake server error:', err);
    return res.status(500).json({ error: 'Server error', detail: String(err?.message || err) });
  }
}
