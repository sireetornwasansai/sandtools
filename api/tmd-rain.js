// Vercel Edge Function: GET /api/tmd-rain — the latest rain observation of the Thai Meteorological Department (กรมอุตุนิยมวิทยา)
// for the weather station nearest to the hospital, for the rain in the campus view (site-sim.js).
// Source: TMD open data "Weather3Hours" (observations at 01, 04, 07, 10, 13, 16, 19 and 22 h Thai time) — https://data.tmd.go.th/api/index1.php
// The browser cannot call TMD itself (the page's Content-Security-Policy only allows 'self'), so this function does it and returns a few numbers.
// Environment variables (all optional): TMD_UID, TMD_UKEY (your own key from data.tmd.go.th; the public demo key is the default), TMD_STATION (WMO number, default 48327 = Chiang Mai).
export const config = { runtime: 'edge' };

const ENDPOINTS = ['https://data.tmd.go.th/api/Weather3Hours/V2/', 'http://data.tmd.go.th/api/Weather3Hours/V2/'];
const decode = (s) => String(s || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml); return m ? decode(m[1]) : ''; };

/** Pure: "MM/DD/YYYY HH:MM:SS" (Thai local time, as TMD writes it) → ISO string with +07:00, or ''. */
export function tmdTime(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}T${m[4]}:${m[5]}:${m[6] || '00'}+07:00` : '';
}
/** Pure: the <Station> block of one WMO number in the Weather3Hours XML → { station, observedAt, rain, rain24 } (rain in mm), or null. */
export function parseStation(xml, wmo) {
  const blocks = String(xml || '').match(/<Station>[\s\S]*?<\/Station>/gi) || [];
  const b = blocks.find((x) => tag(x, 'WmoStationNumber') === String(wmo)); if (!b) return null;
  const obs = tag(b, 'Observation'); const num = (n) => { const v = parseFloat(tag(obs, n)); return Number.isFinite(v) && v >= 0 ? v : 0; };
  const observedAt = tmdTime(tag(obs, 'DateTime')); if (!observedAt) return null;
  return { station: tag(b, 'StationNameThai') || tag(b, 'StationNameEnglish'), observedAt, rain: num('Rainfall'), rain24: num('Rainfall24Hr') };
}

export default async function handler() {
  const uid = (typeof process !== 'undefined' && process.env && process.env.TMD_UID) || 'api'; const key = (typeof process !== 'undefined' && process.env && process.env.TMD_UKEY) || 'api12345';
  const wmo = (typeof process !== 'undefined' && process.env && process.env.TMD_STATION) || '48327';
  const head = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 's-maxage=600, stale-while-revalidate=600' };
  for (const base of ENDPOINTS) {
    try {
      const r = await fetch(`${base}?uid=${encodeURIComponent(uid)}&ukey=${encodeURIComponent(key)}`, { headers: { accept: 'application/xml,text/xml,*/*' } });
      if (!r.ok) continue;
      const s = parseStation(await r.text(), wmo);
      if (s) return new Response(JSON.stringify({ ok: true, source: 'กรมอุตุนิยมวิทยา · Weather3Hours', wmo, ...s }), { status: 200, headers: head });
    } catch { /* try the next endpoint */ }
  }
  return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { ...head, 'cache-control': 'no-store' } });
}
