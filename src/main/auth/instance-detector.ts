import type { InstanceType } from '../../shared/types';
import { ApiClient } from '../api/api-client';
import { isCloudUrl } from './session-manager';

/**
 * Detects what kind of Atlassian instance the URL points to.
 * - Cloud: hostname ends with .atlassian.net
 * - Jira DC: responds to /rest/api/2/serverInfo
 * - Confluence DC: responds to /rest/api/space or /wiki/rest/api/space
 */
export async function detectInstanceType(baseUrl: string, client: ApiClient): Promise<InstanceType> {
  // Cloud detection is simple
  if (isCloudUrl(baseUrl)) {
    return 'cloud';
  }

  // Try Jira DC endpoint
  try {
    const resp = await client.get('/rest/api/2/serverInfo');
    if (resp.ok) {
      const data = await resp.json();
      if (data.serverTitle || data.baseUrl || data.version) {
        return 'jira-dc';
      }
    }
  } catch {
    // Not Jira DC
  }

  // Try Confluence DC endpoint
  try {
    // Some Confluence instances use /wiki context path
    let resp = await client.get('/rest/api/space?limit=1');
    if (!resp.ok) {
      resp = await client.get('/wiki/rest/api/space?limit=1');
    }
    if (resp.ok) {
      return 'confluence-dc';
    }
  } catch {
    // Not Confluence DC
  }

  // Try Confluence DC with different info endpoint
  try {
    const resp = await client.get('/rest/api/accessmode');
    if (resp.ok) {
      return 'confluence-dc';
    }
  } catch {
    // ignore
  }

  throw new Error(
    'Could not detect instance type. Please verify the URL is correct and that you have logged in successfully.'
  );
}
