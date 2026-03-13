export default async function handler(req, res) {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: 'Missing email parameter' });
  }

  try {
    const upstream = await fetch(
      `https://sbit.authconcepts.com:3033/users/by-email?email=${encodeURIComponent(email)}`
    );
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach upstream API' });
  }
}
