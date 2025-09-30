import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, phone } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Forward lead to Lofty
    const response = await fetch('https://api.lofty.ai/lead-intake', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.LOFTY_API_KEY}`,
      },
      body: JSON.stringify({
        name,
        email,
        phone,
        source: 'Website: Georgia Blu Info Form',
        tags: ['Georgia Blu', 'New Development Leads'],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Lofty API error: ${errText}`);
    }

    const data = await response.json();
    return res.status(200).json({ success: true, data });

  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
