// api/lead-intake.ts — Vercel Serverless Function (TypeScript)
// Goal: ensure Lofty receives email/phone in formats it accepts.
// Strategy: send BOTH singular and array forms (email + emails[], phone + phones[])
// plus robust normalization & validation.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const LOFTY_API_BASE = process.env.LOFTY_API_BASE || 'https://api.lofty.com/v1.0';
const LOFTY_API_KEY  = process.env.LOFTY_API_KEY || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s=>s.trim()).filter(Boolean);
const DEFAULT_SOURCE  = process.env.DEFAULT_SOURCE || 'Website: Georgia Blu Info Form';
const DEFAULT_TAGS    = (process.env.DEFAULT_TAGS   || 'Georgia Blu,New Development Leads').split(',').map(s=>s.trim()).filter(Boolean);
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

// --- validation helpers ---
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
function normalizeEmail(v: any): string {
  const s = String(v||'').trim();
  return s;
}
function isValidEmail(v: string): boolean {
  return !!v && emailRe.test(v);
}
function normalizePhoneToE164(v: any): string {
  // Keep digits, plus; assume North America if 10 digits
  const raw = String(v||'').replace(/[^\d+]/g, '');
  if (!raw) return '';
  // already E.164?
  if (raw.startsWith('+')) return raw;
  // strip non-digits, infer +1 if 10 digits
  const digits = raw.replace(/\D/g,'');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return ''; // fail validation
}
function isValidPhoneE164(v: string): boolean {
  return /^\+\d{10,15}$/.test(v);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res, req.headers.origin as string);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (!LOFTY_API_KEY)          return res.status(500).json({ error: 'Missing LOFTY_API_KEY env var' });

  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // Accept both Name/Email/Phone and firstName/email/phone, plus tags or tags[]
    const firstName = raw.firstName ?? raw.FirstName ?? raw.Name ?? raw.name ?? '';
    const lastName  = raw.lastName  ?? raw.LastName  ?? '';
    const emailIn   = raw.email     ?? raw.Email     ?? '';
    const phoneIn   = raw.phone     ?? raw.Phone     ?? '';
    const message   = raw.message   ?? raw.Message   ?? '';
    const hp        = raw.hp        ?? raw._honey    ?? '';
    const source    = String(raw.source ?? DEFAULT_SOURCE).trim();

    let tags: string[] = [];
    const tagsInput = raw.tags ?? raw['tags[]'];
    if (Array.isArray(tagsInput)) tags = tagsInput.map(String);
    else if (typeof tagsInput === 'string') tags = [tagsInput];

    // Honeypot → pretend success
    if (hp) return res.status(200).json({ ok: true });

    // Normalize & validate
    const email = normalizeEmail(emailIn);
    const phone = normalizePhoneToE164(phoneIn);

    if (!String(firstName).trim()) {
      return res.status(422).json({ error: 'First name is required.' });
    }
    if (!email && !phone) {
      return res.status(422).json({ error: 'Provide at least an email or a phone.' });
    }
    if (email && !isValidEmail(email)) {
      return res.status(422).json({ error: 'Email is not valid.' });
    }
    if (phoneIn && !phone) {
      return res.status(422).json({ error: 'Phone number is not valid. Use 10 digits (NA) or an international format.' });
    }
    if (phone && !isValidPhoneE164(phone)) {
      return res.status(422).json({ error: 'Phone is not valid E.164.' });
    }

    // Build Lofty payload — use camelCase and send multiple forms for email/phone
    const payload: Record<string, any> = stripUndefined({
      firstName: String(firstName).trim(),
      lastName:  String(lastName || '').trim() || undefined,
      source,
      tags:      [...DEFAULT_TAGS, ...tags].map(s => String(s).trim()).filter(Boolean),
      notes:     message ? String(message).trim() : '',
      // Primary fields
      email:     email || undefined,
      phone:     phone || undefined,
      // Also send arrays of strings for maximum compatibility
      emails:    email ? [email] : undefined,
      phones:    phone ? [phone] : undefined,
    });

    if (FORCE_ASSIGNEE_ID) {
      // try both camelCase and snake just in case Lofty uses either
      payload.assigneeId = FORCE_ASSIGNEE_ID;
      payload.assignee_id = FORCE_ASSIGNEE_ID;
    }

    console.log('→ Lofty payload (multi-form contacts)', payload);

    const r = await fetch(`${LOFTY_API_BASE}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // If Lofty requires Bearer instead of token, flip this:
        'Authorization': `token ${LOFTY_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    console.log('Lofty status', r.status, 'body:', text);

    if (!r.ok) {
      return res.status(502).json({ error: 'Lofty API error', detail: text });
    }

    let id: string | number | null = null;
    try {
      const data = JSON.parse(text || '{}');
      id = data?.id ?? data?.leadId ?? data?.lead?.id ?? data?.data?.id ?? null;
    } catch {}

    return res.status(200).json({ ok: true, loftyLeadId: id });
  } catch (err: any) {
    console.error('lead-intake server error:', err);
    return res.status(500).json({ error: 'Server error', detail: String(err?.message || err) });
  }
}
