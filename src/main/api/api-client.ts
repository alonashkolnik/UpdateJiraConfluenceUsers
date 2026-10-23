import { net, Session, ClientRequestConstructorOptions } from 'electron';
import { logger } from '../logger';

export class ApiClient {
  constructor(
    private baseUrl: string,
    private session: Session
  ) {}

  private buildUrl(path: string): string {
    // If path already starts with http, use as-is
    if (path.startsWith('http')) return path;
    const base = this.baseUrl.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : '/' + path;
    return base + p;
  }

  async get(path: string, params?: Record<string, string>): Promise<Response> {
    let url = this.buildUrl(path);
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += (url.includes('?') ? '&' : '?') + qs;
    }
    return this.request(url, 'GET');
  }

  async post(path: string, body?: unknown): Promise<Response> {
    return this.request(this.buildUrl(path), 'POST', body);
  }

  async put(path: string, body?: unknown): Promise<Response> {
    return this.request(this.buildUrl(path), 'PUT', body);
  }

  async patch(path: string, body?: unknown): Promise<Response> {
    return this.request(this.buildUrl(path), 'PATCH', body);
  }

  async delete(path: string, params?: Record<string, string>): Promise<Response> {
    let url = this.buildUrl(path);
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += (url.includes('?') ? '&' : '?') + qs;
    }
    return this.request(url, 'DELETE');
  }

  /**
   * Manually extract cookies from the Electron session cookie store
   * and build a Cookie header string. This is CRITICAL — net.request
   * does not always automatically attach session cookies.
   */
  private async getCookieHeader(url: string): Promise<string> {
    try {
      // First try matching by URL (standard approach)
      let cookies = await this.session.cookies.get({ url });

      // If no cookies found by URL, try by domain as fallback
      // (non-standard ports like :8443 can cause URL-based matching to miss cookies)
      if (cookies.length === 0) {
        const parsedUrl = new URL(url);
        const domain = parsedUrl.hostname;
        logger.debug('HTTP', `No cookies found by URL, trying domain: ${domain}`);
        cookies = await this.session.cookies.get({ domain });
      }

      // Last resort: dump ALL cookies in session for diagnostics
      if (cookies.length === 0) {
        const allCookies = await this.session.cookies.get({});
        if (allCookies.length > 0) {
          logger.warn('HTTP', `No cookies matched for ${url}, but session has ${allCookies.length} total cookies:`);
          for (const c of allCookies.slice(0, 10)) {
            logger.warn('HTTP', `  Cookie: ${c.name} domain=${c.domain} path=${c.path} secure=${c.secure} httpOnly=${c.httpOnly}`);
          }
          // Use ALL cookies as last resort — better than sending none
          cookies = allCookies;
        } else {
          logger.warn('HTTP', `Session has ZERO cookies — login may not have persisted`);
        }
      }

      if (cookies.length > 0) {
        const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        logger.debug('HTTP', `Injecting ${cookies.length} cookies for ${url}`);
        return cookieHeader;
      }
    } catch (err: any) {
      logger.warn('HTTP', `Failed to get cookies for ${url}: ${err.message}`);
    }
    return '';
  }

  private async request(url: string, method: string, body?: unknown): Promise<Response> {
    const parsedUrl = new URL(url);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      // Confluence CSRF bypass — required for POST/PUT/DELETE on DC
      'X-Atlassian-Token': 'no-check',
      // Origin & Referer help with CORS and CSRF checks
      Origin: parsedUrl.origin,
      Referer: parsedUrl.origin,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    // CRITICAL: Manually inject cookies from the session cookie store.
    // net.request does not reliably send session cookies automatically.
    const cookieHeader = await this.getCookieHeader(url);
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    logger.debug('HTTP', `${method} ${url}`);

    const resp = await new Promise<Response>((resolve, reject) => {
      try {
        const opts: ClientRequestConstructorOptions = {
          method,
          url,
          session: this.session,
        };

        const req = net.request(opts);

        // Set all headers including manually-injected cookies
        for (const [key, value] of Object.entries(headers)) {
          req.setHeader(key, value);
        }

        // Collect response
        req.on('response', (incomingMessage) => {
          const chunks: Buffer[] = [];
          incomingMessage.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          incomingMessage.on('end', () => {
            const bodyStr = Buffer.concat(chunks).toString('utf-8');
            const responseHeaders = new Headers();
            const rawHeaders = incomingMessage.headers;
            for (const [key, value] of Object.entries(rawHeaders)) {
              if (typeof value === 'string') {
                responseHeaders.set(key, value);
              } else if (Array.isArray(value)) {
                for (const v of value) {
                  responseHeaders.append(key, v);
                }
              }
            }
            // A Response for 204/205/304 must not have a body (even an empty string)
            const nullBody = [204, 205, 304].includes(incomingMessage.statusCode);
            const response = new Response(nullBody ? null : bodyStr, {
              status: incomingMessage.statusCode,
              statusText: incomingMessage.statusMessage || '',
              headers: responseHeaders,
            });
            logger.debug('HTTP', `${method} ${url} → ${incomingMessage.statusCode}`);
            resolve(response);
          });
          incomingMessage.on('error', (err: Error) => {
            reject(err);
          });
        });

        req.on('error', (err: Error) => {
          logger.error('HTTP', `${method} ${url} → network error: ${err.message}`);
          reject(err);
        });

        // Write body
        if (body !== undefined) {
          req.write(JSON.stringify(body));
        }
        req.end();
      } catch (err) {
        reject(err);
      }
    });

    // Handle rate limiting
    if (resp.status === 429) {
      const retryAfter = resp.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
      logger.warn('HTTP', `Rate limited on ${url}, waiting ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      return this.request(url, method, body);
    }

    return resp;
  }
}
