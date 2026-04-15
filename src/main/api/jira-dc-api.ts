import type { IAtlassianApi } from './types';
import type { AtlassianUser, UserDetails, GroupInfo } from '../../shared/types';
import { ApiClient } from './api-client';
import { logger } from '../logger';

/**
 * Jira Data Center API implementation.
 * Uses /rest/api/2 endpoints. User identifier is typically 'username' or 'key'.
 */
export class JiraDcApi implements IAtlassianApi {
  constructor(private client: ApiClient) {}

  async getCurrentUser(): Promise<AtlassianUser> {
    const resp = await this.client.get('/rest/api/2/myself');
    if (!resp.ok) throw new Error(`Failed to get current user: ${resp.status}`);
    const data = await resp.json();
    // Jira DC returns 401 for unauthenticated, but check just in case
    if (!data.name && !data.key) {
      throw new Error('Not authenticated — Jira returned no user identity');
    }
    return this.mapUser(data);
  }

  async searchUsers(query: string): Promise<AtlassianUser[]> {
    const resp = await this.client.get('/rest/api/2/user/search', {
      username: query,
      maxResults: '50',
      includeActive: 'true',
      includeInactive: 'true',
      expand: 'groups,applicationRoles',
    });
    if (!resp.ok) throw new Error(`User search failed: ${resp.status}`);
    const data: any[] = await resp.json();
    return data.map(this.mapUser);
  }

  async getAllUsers(_startAt = 0, maxResults = 200): Promise<AtlassianUser[]> {
    // Jira DC user/search has a hard cap per query (often 100-1000).
    // Strategy: first try alphabetical prefix queries (a-z, 0-9) to cover all users,
    // with standard pagination within each prefix.
    // Fall back to simple wildcard if the Crowd REST API isn't available.

    // Try 1: Crowd REST search (returns all users with proper pagination)
    try {
      const crowdUsers = await this.getAllUsersViaCrowd(maxResults);
      if (crowdUsers.length > 0) {
        return crowdUsers;
      }
    } catch (err: any) {
      logger.debug('JIRA', `Crowd API not available: ${err.message}`);
    }

    // Try 2: Letter-by-letter search to overcome per-query limits
    const seen = new Map<string, AtlassianUser>();
    const prefixes = 'abcdefghijklmnopqrstuvwxyz0123456789_'.split('');

    for (const prefix of prefixes) {
      let start = 0;
      let hasMore = true;

      while (hasMore) {
        const resp = await this.client.get('/rest/api/2/user/search', {
          username: prefix,
          startAt: String(start),
          maxResults: String(maxResults),
          includeActive: 'true',
          includeInactive: 'true',
        });
        if (!resp.ok) break;
        const data: any[] = await resp.json();

        for (const d of data) {
          const user = this.mapUser(d);
          const id = user.key || user.username;
          if (!seen.has(id)) {
            seen.set(id, user);
          }
        }

        if (data.length < maxResults) {
          hasMore = false;
        } else {
          start += maxResults;
        }
      }
    }

    logger.info('JIRA', `getAllUsers complete (letter search): ${seen.size} users loaded`);
    return Array.from(seen.values());
  }

  /**
   * Try the Crowd REST API which supports proper pagination for all users.
   */
  private async getAllUsersViaCrowd(maxResults = 200): Promise<AtlassianUser[]> {
    const allUsers: AtlassianUser[] = [];
    let start = 0;
    let hasMore = true;

    while (hasMore) {
      const resp = await this.client.get('/rest/api/2/user/search', {
        username: '%',
        startAt: String(start),
        maxResults: String(maxResults),
        includeActive: 'true',
        includeInactive: 'true',
      });
      if (!resp.ok) throw new Error(`Crowd search failed: ${resp.status}`);
      const data: any[] = await resp.json();

      logger.debug('JIRA', `getAllUsersViaCrowd page: startAt=${start} returned=${data.length}`);

      const users = data.map(this.mapUser);
      allUsers.push(...users);

      if (data.length < maxResults) {
        hasMore = false;
      } else {
        start += maxResults;
        // Safety cap — don't fetch more than 10000 users
        if (start >= 10000) {
          logger.warn('JIRA', `Stopping at ${start} users (safety cap)`);
          hasMore = false;
        }
      }
    }

    logger.info('JIRA', `getAllUsersViaCrowd complete: ${allUsers.length} users loaded`);
    return allUsers;
  }

  async getUserByKeyOrName(identifier: string): Promise<AtlassianUser | null> {
    // Try by key first
    try {
      const resp = await this.client.get('/rest/api/2/user', { key: identifier });
      if (resp.ok) {
        const data = await resp.json();
        return this.mapUser(data);
      }
    } catch { /* ignore */ }

    // Try by username
    try {
      const resp = await this.client.get('/rest/api/2/user', { username: identifier });
      if (resp.ok) {
        const data = await resp.json();
        return this.mapUser(data);
      }
    } catch { /* ignore */ }

    // Try search
    const results = await this.searchUsers(identifier);
    if (results.length > 0) {
      return results.find(u =>
        u.email.toLowerCase() === identifier.toLowerCase() ||
        u.username.toLowerCase() === identifier.toLowerCase() ||
        u.key === identifier
      ) || results[0];
    }
    return null;
  }

  async getUserDetails(identifier: string): Promise<UserDetails> {
    const user = await this.getUserByKeyOrName(identifier);
    if (!user) throw new Error(`User not found: ${identifier}`);

    const groups = await this.getUserGroups(user.key || user.username);
    return { ...user, groups };
  }

  async getAllGroups(): Promise<GroupInfo[]> {
    const groups: GroupInfo[] = [];
    // Use groups picker which supports searching
    const resp = await this.client.get('/rest/api/2/groups/picker', {
      query: '',
      maxResults: '1000',
    });
    if (!resp.ok) throw new Error(`Failed to load groups: ${resp.status}`);
    const data = await resp.json();
    const groupsList = data.groups || [];
    for (const g of groupsList) {
      groups.push({ name: g.name });
    }
    return groups;
  }

  async getUserGroups(identifier: string): Promise<string[]> {
    // Try to get groups via user?expand=groups
    let resp = await this.client.get('/rest/api/2/user', {
      key: identifier,
      expand: 'groups',
    });
    if (!resp.ok) {
      resp = await this.client.get('/rest/api/2/user', {
        username: identifier,
        expand: 'groups',
      });
    }
    if (!resp.ok) throw new Error(`Failed to get user groups: ${resp.status}`);
    const data = await resp.json();
    const groups = data.groups?.items || [];
    return groups.map((g: any) => g.name);
  }

  async addUserToGroup(identifier: string, groupName: string): Promise<void> {
    // Resolve to username — Jira DC group APIs require username, not userKey
    const user = await this.getUserByKeyOrName(identifier);
    const username = user?.username || identifier;

    const resp = await this.client.post(`/rest/api/2/group/user?groupname=${encodeURIComponent(groupName)}`, {
      name: username,
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Failed to add user to group ${groupName}: ${err}`);
    }
  }

  async removeUserFromGroup(identifier: string, groupName: string): Promise<void> {
    // Resolve to username — Jira DC group APIs require username, not userKey
    const user = await this.getUserByKeyOrName(identifier);
    const username = user?.username || identifier;

    const resp = await this.client.delete(
      `/rest/api/2/group/user?groupname=${encodeURIComponent(groupName)}&username=${encodeURIComponent(username)}`
    );
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Failed to remove user from group ${groupName}: ${err}`);
    }
  }

  // Product access — not applicable for DC (managed via admin console)
  async getAllApplicationRoles(): Promise<import('../../shared/types').ApplicationRoleInfo[]> { return []; }
  async getUserApplicationRoles(_identifier: string): Promise<string[]> { return []; }
  async addUserToApplicationRole(_identifier: string, _roleKey: string): Promise<void> {
    throw new Error('Product access management is not available for Jira Data Center');
  }
  async removeUserFromApplicationRole(_identifier: string, _roleKey: string): Promise<void> {
    throw new Error('Product access management is not available for Jira Data Center');
  }

  async activateUser(identifier: string): Promise<void> {
    // Jira DC: use the admin endpoint to update user active flag
    // Try the REST endpoint for updating user application access
    const resp = await this.client.put(`/rest/api/2/user?key=${encodeURIComponent(identifier)}`, {
      active: true,
    });
    if (!resp.ok) {
      // Fallback: try the admin HTML endpoint
      const resp2 = await this.client.post('/secure/admin/user/EditUser.jspa', {
        editName: identifier,
        active: 'true',
      });
      if (!resp2.ok) {
        throw new Error(`Failed to activate user: ${resp.status}`);
      }
    }
  }

  async deactivateUser(identifier: string): Promise<void> {
    const resp = await this.client.put(`/rest/api/2/user?key=${encodeURIComponent(identifier)}`, {
      active: false,
    });
    if (!resp.ok) {
      const resp2 = await this.client.post('/secure/admin/user/EditUser.jspa', {
        editName: identifier,
        active: 'false',
      });
      if (!resp2.ok) {
        throw new Error(`Failed to deactivate user: ${resp.status}`);
      }
    }
  }

  async updateUserEmail(identifier: string, newEmail: string): Promise<void> {
    const resp = await this.client.put(`/rest/api/2/user?key=${encodeURIComponent(identifier)}`, {
      emailAddress: newEmail,
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Failed to update email: ${err}`);
    }
  }

  async updateUserName(identifier: string, newUsername: string): Promise<void> {
    const resp = await this.client.put(`/rest/api/2/user?key=${encodeURIComponent(identifier)}`, {
      name: newUsername,
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Failed to update username: ${err}`);
    }
  }

  private mapUser(data: any): AtlassianUser {
    return {
      key: data.key,
      username: data.name || data.key || '',
      displayName: data.displayName || '',
      email: data.emailAddress || '',
      active: data.active ?? true,
      lastLogin: data.lastLoginTime || data.lastSuccessfulLoginDate || undefined,
      lastUpdated: data.updatedDate || data.lastModifiedDate || undefined,
    };
  }
}
