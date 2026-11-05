/** The server this private app talks to. Fixed on purpose: the app can never be pointed somewhere else. */
export const SERVER = 'https://va-api.aboenterprise.com';

export const APP_VERSION = '0.1.0';

/** The makers, shown on About. */
export const CREDITS = {
  maker: { name: 'SUMON', url: 'https://mumainsumon.netlify.app' },
  company: { name: 'ABO ENTERPRISE', url: 'https://www.aboenterprise.com' },
} as const;
