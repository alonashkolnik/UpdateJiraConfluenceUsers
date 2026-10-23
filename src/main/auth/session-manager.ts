import { session, Session } from 'electron';
import crypto from 'crypto';
import type { InstanceType } from '../../shared/types';
import { logger } from '../logger';
import { getMainWindow } from '../index';
import { installCertificateCheck } from './cert-trust';

/** Hash a URL to create a unique partition name */
function hashUrl(url: string): string {
  return crypto.createHash('md5').update(url.toLowerCase().replace(/\/+$/, '')).digest('hex').slice(0, 12);
}

/** Per-instance sessions keyed by base URL */
const sessions = new Map<string, { ses: Session; instanceType: InstanceType | null }>();

export function getOrCreateSession(baseUrl: string): Session {
  const key = hashUrl(baseUrl);
  if (sessions.has(key)) {
    return sessions.get(key)!.ses;
  }
  const partitionName = `persist:atlassian-${key}`;
  const ses = session.fromPartition(partitionName);

  // Many on-prem Jira/Confluence Data Center installations use self-signed or
  // internal-CA certificates: let the user trust this instance's certificate;
  // everything else (Cloud, SSO hosts, ...) is verified normally.
  installCertificateCheck(ses, new URL(baseUrl).hostname, getMainWindow);
  logger.info('SESSION', `Created session ${partitionName}`);

  sessions.set(key, { ses, instanceType: null });
  return ses;
}

export function clearSession(baseUrl: string): void {
  const key = hashUrl(baseUrl);
  const entry = sessions.get(key);
  if (entry) {
    entry.ses.clearStorageData();
    entry.ses.clearCache();
  }
}

export function setInstanceType(baseUrl: string, type: InstanceType): void {
  const key = hashUrl(baseUrl);
  const entry = sessions.get(key);
  if (entry) {
    entry.instanceType = type;
  }
}

export function getInstanceType(baseUrl: string): InstanceType | null {
  const key = hashUrl(baseUrl);
  return sessions.get(key)?.instanceType ?? null;
}

export function getSessionForUrl(baseUrl: string): Session | null {
  const key = hashUrl(baseUrl);
  return sessions.get(key)?.ses ?? null;
}

/** Detect whether a URL points to a Cloud instance */
export function isCloudUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.endsWith('.atlassian.net');
  } catch {
    return false;
  }
}

/** Normalize a base URL: ensure https, strip trailing slash */
export function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = 'https://' + normalized;
  }
  normalized = normalized.replace(/\/+$/, '');
  return normalized;
}
