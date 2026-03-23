export default async function handler(req, res) {
  try {
    const upstream = await fetch('https://sbit.authconcepts.com:3033/users/');
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach upstream API' });
  }
}
