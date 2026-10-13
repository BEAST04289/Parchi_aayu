import 'server-only';
import QRCode from 'qrcode';

/** Kiosk URL on the same origin the staff member is using (works for localhost, LAN and the HTTPS deployment). */
export async function kioskLink(req: Request, token: string): Promise<{ kiosk_url: string; qr_data_url: string }> {
  const fwdHost = req.headers.get('x-forwarded-host');
  const fwdProto = req.headers.get('x-forwarded-proto');
  const u = new URL(req.url);
  const origin = process.env.APP_URL || (fwdHost ? `${fwdProto ?? 'https'}://${fwdHost}` : u.origin);
  const kiosk_url = `${origin.replace(/\/$/, '')}/k/${token}`;
  const qr_data_url = await QRCode.toDataURL(kiosk_url, { margin: 1, width: 320, color: { dark: '#153342', light: '#FFFFFF' } });
  return { kiosk_url, qr_data_url };
}
