// api/lead-intake.ts — Vercel Serverless Function (TypeScript)
// Route: /api/lead-intake

import type { VercelRequest, VercelResponse } from '@vercel/node';

// ====== ENV ======
const LOFTY_API_BASE = process.env.LOFTY_API_BASE || 'https://api.lofty.com/v1.0';
const LOFTY_API_KEY  = process.env.LOFTY_API_KEY || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const DEFAULT_SOURCE = process.env.DEFAULT_SOURCE || 'Website: Georgia Blu Info Form';
const DEFAULT_TAGS   = (process.env.DEFAULT_TAGS || 'Georgia Blu,New Development Leads')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const FORCE_ASSIGNEE_ID = process.env.FORCE_ASSIGNEE_ID; // optional

// ====== CORS ======
function setCORS(res: VercelResponse, origin?: string) {
  const allowAny  = ALLOWED_ORIGINS.includes('*');
  const allowThis = origin && (allowAny || ALLOWED_ORIGINS.includes(origin));
  res.setHeader('Access-Control-Allow-Origin', allowThis ? (origin as string) : '*');
  res.setHeader('Vary', 'Origin'); // important for edge caching correctness
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ====== Helpers ======
function stripUndefined<T extends Record<string, any>>(obj: T): T {
  Object.keys(obj).forEach(k => obj[k] === undefined && delete obj[k]);
  return obj;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res, req.headers.origin as string);

  // Preflight
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Only POST
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Guard: API key
  if (!LOFTY_API_KEY) return res.status(500).json({ error: 'Missing LOFTY_API_KEY env var' });

  // Log basic request context (safe)
  console.log('lead-intake request', {
    method: req.method,
    origin: req.headers.origin,
    referer: req.headers.referer
  });

  try {
    // Parse body (JSON string or object)
    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // Accept multiple naming styles (Lofty blocks, your forms, FormSubmit fallbacks)
    const firstName = raw.firstName ?? raw.FirstName ?? raw.Name ?? raw.name ?? '';
    const lastName  = raw.lastName  ?? raw.LastName  ?? '';
    const email     = raw.email     ?? raw.Email     ?? '';
    const phone     = raw.phone     ?? raw.Phone     ?? '';
    const message   = raw.message   ?? raw.Message   ?? '';
    const hp        = raw.hp        ?? raw._honey    ?? ''; // honeypot
    const source    = (raw.source ?? DEFAULT_SOURCE) as string;

    // tags may come as tags (array or string) or 'tags[]'
    let tags: string[] = [];
    const tagsInput = raw.tags ?? raw['tags[]'];
    if (Array.isArray(tagsInput)) tags = tagsInput.map(String);
    else if (typeof tagsInput === 'string') tags = [tagsInput];

    // Bot trap: if honeypot touched, pretend success
    if (hp) return res.status(200).json({ ok: true });

    // Minimal validation
    if (!String(firstName).trim() || (!String(email).trim() && !String(phone).trim())) {
      return res.status(400).json({ error: 'Need first name and (email or phone)' });
    }

    // ====== Lofty payload (flat) ======
    const payload = stripUndefined({
      first_name: String(firstName).trim(),
      last_name:  String(lastName || '').trim() || undefined,
      email:      String(email || '').trim() || undefined,
      phone:      String(phone || '').trim() || undefined,
      source:     String(source).trim(),
      tags:       [...DEFAULT_TAGS, ...tags].map(s => String(s).trim()).filter(Boolean),
      notes:      message ? String(message).trim() : ''
    });

    if (FORCE_ASSIGNEE_ID) (payload as any).assignee_id = FORCE_ASSIGNEE_ID;

    // Debug log (remove later if you like)
    console.log('→ Lofty payload (flat)', payload);

    // ====== Send to Lofty ======
    const r = await fetch(`${LOFTY_API_BASE}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // If Lofty expects "Bearer", swap to `Bearer ${LOFTY_API_KEY}`
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
