const encoder = new TextEncoder();

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes).slice(0, 12)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validate({ salt, day, ip }) {
  if (typeof salt !== 'string' || !salt || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof ip !== 'string' || !ip || ip.length > 128) throw new Error('Invalid visitor identity');
}

// Matches the existing Cloudflare Worker's daily reader fingerprint.
export async function readerFingerprint({ salt, day, ip, userAgent }) {
  validate({ salt, day, ip });
  if (typeof userAgent !== 'string' || userAgent.length > 4096) throw new Error('Invalid user agent');
  return digest(`${salt}|${day}|${ip}|${userAgent}`);
}

// Matches the existing Worker's daily vote fingerprint, including IPv6 /64 grouping.
export async function voterFingerprint({ salt, day, ip }) {
  validate({ salt, day, ip });
  const [head, tail = ''] = ip.toLowerCase().split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  const voter = ip.includes(':') ? groups.map(group => group.replace(/^0+(?=.)/, '')).slice(0, 4).join(':') + '::/64' : ip;
  return digest(`${salt}|like|${day}|${voter}`);
}
