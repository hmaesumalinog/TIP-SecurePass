function config() {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !secret) throw new Error('Supabase environment variables are not configured.');
  return { baseUrl, secret };
}

export async function supabase(path, options = {}) {
  const { baseUrl, secret } = config();
  const headers = new Headers(options.headers || {});
  headers.set('apikey', secret);
  if (!secret.startsWith('sb_secret_')) headers.set('Authorization', `Bearer ${secret}`);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, { ...options, headers });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = text; }
  }
  if (!response.ok) {
    const detail = data?.message || data?.hint || `Supabase returned ${response.status}`;
    throw new Error(detail);
  }
  return data;
}

export function query(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => search.set(key, String(value)));
  return search.toString();
}

export async function insert(table, row, select = '*') {
  return supabase(`${table}?select=${encodeURIComponent(select)}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row)
  });
}

export async function update(table, filters, values, select = 'id') {
  return supabase(`${table}?${query(filters)}&select=${encodeURIComponent(select)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(values)
  });
}
