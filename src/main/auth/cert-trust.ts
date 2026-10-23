import { dialog, BrowserWindow, Session, Request } from 'electron';
import { logger } from '../logger';

/** Certificates the user accepted this run: hostname → SHA-256 fingerprint */
const trustedCerts = new Map<string, string>();
/** Certificates the user declined during the current connection attempt */
const declinedCerts = new Set<string>();
/** Prompts in flight, so parallel connections to one host ask only once */
const pendingPrompts = new Map<string, Promise<boolean>>();

function isAtlassianCloud(hostname: string): boolean {
  return hostname === 'atlassian.net' || hostname.endsWith('.atlassian.net');
}

async function askUser(parent: BrowserWindow | null, request: Request): Promise<boolean> {
  const { hostname, certificate, verificationResult } = request;
  const options = {
    type: 'warning' as const,
    title: 'Untrusted certificate',
    message: `The certificate for ${hostname} is not trusted.`,
    detail:
      `Reason: ${verificationResult}\n` +
      `Issued by: ${certificate.issuerName}\n` +
      `SHA-256 fingerprint: ${certificate.fingerprint}\n\n` +
      "Only continue if this is your company's Jira/Confluence Data Center server and you expect it " +
      'to use a self-signed or internal certificate. Otherwise someone may be intercepting the connection.',
    buttons: ['Cancel', 'Trust this certificate'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return result.response === 1;
}

/**
 * Use Chromium's normal certificate verification for everything on `ses`,
 * except that a certificate it rejects for `allowedHost` (a Data Center
 * server, never Atlassian Cloud) can be trusted after the user confirms it.
 */
export function installCertificateCheck(ses: Session, allowedHost: string, getParent: () => BrowserWindow | null): void {
  ses.setCertificateVerifyProc((request, callback) => {
    const { hostname, verificationResult, certificate } = request;
    if (verificationResult === 'net::OK' || hostname !== allowedHost || isAtlassianCloud(hostname)) {
      callback(-3); // use Chromium's verdict
      return;
    }

    const key = `${hostname} ${certificate.fingerprint}`;
    if (trustedCerts.get(hostname) === certificate.fingerprint) {
      callback(0);
      return;
    }
    if (declinedCerts.has(key)) {
      callback(-2);
      return;
    }

    let prompt = pendingPrompts.get(key);
    if (!prompt) {
      prompt = askUser(getParent(), request)
        .catch(() => false)
        .then((trusted) => {
          pendingPrompts.delete(key);
          if (trusted) trustedCerts.set(hostname, certificate.fingerprint);
          else declinedCerts.add(key);
          logger.info('CERT', `${hostname}: user ${trusted ? 'trusted' : 'rejected'} certificate ${certificate.fingerprint}`);
          return trusted;
        });
      pendingPrompts.set(key, prompt);
    }
    prompt.then((trusted) => callback(trusted ? 0 : -2));
  });
}

/** Forget "Cancel" answers so a new connection attempt can ask again */
export function forgetDeclinedCertificates(): void {
  declinedCerts.clear();
}
