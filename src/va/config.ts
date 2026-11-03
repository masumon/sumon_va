/** The server this private app talks to. Fixed on purpose: the app can never be pointed somewhere else. */
export const SERVER = 'https://api.aboenterprise.com';

export const APP_VERSION = '0.1.0';

/** The makers, shown on About. Apon's design credit is kept as the Apon app states it. */
export const CREDITS = {
  maker: { name: 'SUMON', url: 'https://mumainsumon.netlify.app' },
  designer: { name: 'MD ABDUR RAHMAN FAHIM', facebook: 'https://www.facebook.com/fahimbd99', email: 'abdur.r3030@gmail.com' },
  company: { name: 'ABO ENTERPRISE', url: 'https://www.aboenterprise.com' },
} as const;
