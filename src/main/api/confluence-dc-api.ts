import type { IAtlassianApi } from './types';
import type { AtlassianUser, UserDetails, GroupInfo } from '../../shared/types';
import { ApiClient } from './api-client';
import { logger } from '../logger';

/**
 * Confluence Data Center API implementation.
 * Uses /rest/api endpoints. Some instances use /wiki prefix.
 */
export class ConfluenceDcApi implements IAtlassianApi {
  private prefix = '';

  constructor(private client: ApiClient) {}

  /** Detect whether this instance uses /wiki prefix */
  async init(): Promise<void> {
    const resp = await this.client.get('/rest/api/user/current');
    if (resp.ok) {
      this.prefix = '';
      return;
    }
    const resp2 = await this.client.get('/wiki/rest/api/user/current');
    if (resp2.ok) {
      this.prefix = '/wiki';
      return;
    }
    // Default to no prefix
    this.prefix = '';
  }

  private api(path: string): string {
    return `${this.prefix}${path}`;
  }

  async getCurrentUser(): Promise<AtlassianUser> {
    const resp = await this.client.get(this.api('/rest/api/user/current'));
    if (!resp.ok) throw new Error(`Failed to get current user: ${resp.status}`);
    const data = await resp.json();
    // Confluence returns "anonymous" type or empty username for unauthenticated requests
    if (!data.username || data.type === 'anonymous' || data.displayName === 'Anonymous') {
      throw new Error('Not authenticated — Confluence returned anonymous user');
    }
    return this.mapUser(data);
  }

  async searchUsers(query: string): Promise<AtlassianUser[]> {
    // Confluence DC: search via CQL or user list endpoint
    const resp = await this.client.get(this.api('/rest/api/search/user'), {
      cql: `user.fullname ~ "${query}" OR user.email ~ "${query}"`,
      limit: '50',
      expand: 'status',
    });
    if (resp.ok) {
      const data = await resp.json();
      const results = data.results || [];
      return results.map((r: any) => this.mapUser(r.user || r));
    }

    // Fallback: use the user list with filter
    const resp2 = await this.client.get(this.api('/rest/api/user/list'), {
      limit: '50',
      expand: 'status',
    });
    if (!resp2.ok) throw new Error(`User search failed: ${resp2.status}`);
    const data2 = await resp2.json();
    const users = (data2.results || []).map((u: any) => this.mapUser(u));
    // Client-side filter
    const q = query.toLowerCase();
    return users.filter((u: AtlassianUser) =>
      u.username.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  }

  async getAllUsers(startAt = 0, maxResults = 200): Promise<AtlassianUser[]> {
    const allUsers: AtlassianUser[] = [];
    let start = startAt;
    let hasMore = true;

    while (hasMore) {
      const resp = await this.client.get(this.api('/rest/api/user/list'), {
        start: String(start),
        limit: String(maxResults),
        expand: 'status',
      });
      if (!resp.ok) throw new Error(`Failed to load users: ${resp.status}`);
      const data = await resp.json();
      const results = data.results || [];
      allUsers.push(...results.map((u: any) => this.mapUser(u)));

      if (results.length < maxResults) {
        hasMore = false;
      } else {
        start += maxResults;
      }
    }
    return allUsers;
  }

  async getUserByKeyOrName(identifier: string): Promise<AtlassianUser | null> {
    // Try by key
    try {
      const resp = await this.client.get(this.api('/rest/api/user'), { key: identifier, expand: 'status' });
      if (resp.ok) {
        const data = await resp.json();
        return this.mapUser(data);
      }
    } catch { /* ignore */ }

    // Try by username
    try {
      const resp = await this.client.get(this.api('/rest/api/user'), { username: identifier, expand: 'status' });
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
        u.username.toLowerCase() === identifier.toLowerCase()
      ) || results[0];
    }
    return null;
  }

  /**
   * Helper to call a Confluence JSON-RPC method and check for errors.
   * Returns the parsed result on success (truthy — at minimum `true` for void methods),
   * or null if the call failed.
   */
  private async jsonRpc(method: string, params: unknown[]): Promise<any | null> {
    try {
      const resp = await this.client.post(
        this.api(`/rpc/json-rpc/confluenceservice-v2/${method}`),
        params
      );
      if (!resp.ok) {
        logger.debug('CONFLUENCE', `JSON-RPC ${method} HTTP ${resp.status}`);
        return null;
      }
      // Try to parse response body — void methods may return empty/null
      let data: any;
      try {
        const text = await resp.text();
        data = text ? JSON.parse(text) : null;
      } catch {
        // Empty or non-JSON body on 200 OK = success for void methods
        logger.debug('CONFLUENCE', `JSON-RPC ${method} → void (success)`);
        return true;
      }
      // JSON-RPC can return 200 but with an error envelope
      if (data && typeof data === 'object' && data.error) {
        logger.debug('CONFLUENCE', `JSON-RPC ${method} error: ${JSON.stringify(data.error)}`);
        return null;
      }
      logger.debug('CONFLUENCE', `JSON-RPC ${method} → ${JSON.stringify(data).substring(0, 500)}`);
      // Return data, or true for null/void responses (HTTP 200 = success)
      return data ?? true;
    } catch (err: any) {
      logger.debug('CONFLUENCE', `JSON-RPC ${method} exception: ${err.message}`);
      return null;
    }
  }

  async getUserDetails(identifier: string): Promise<UserDetails> {
    const user = await this.getUserByKeyOrName(identifier);
    if (!user) throw new Error(`User not found: ${identifier}`);

    // Confluence DC REST API doesn't return email — try multiple approaches
    if (!user.email && user.username) {
      // Approach 1: REST API with expand=details.personal
      try {
        const detResp = await this.client.get(this.api('/rest/api/user'), {
          key: user.key || user.username,
          expand: 'details.personal',
        });
        if (detResp.ok) {
          const detData = await detResp.json();
          logger.debug('CONFLUENCE', `User details with expand: ${JSON.stringify(detData).substring(0, 500)}`);
          const email = detData.details?.personal?.email || detData.email || detData.emailAddress;
          if (email) user.email = email;
        }
      } catch (err: any) {
        logger.debug('CONFLUENCE', `Expand details failed: ${err.message}`);
      }

      // Approach 2: Try user profile page scraping (the profile contains email)
      if (!user.email) {
        try {
          const profileResp = await this.client.get(
            this.api(`/rest/mobile/1.0/profile/${encodeURIComponent(user.username)}`)
          );
          if (profileResp.ok) {
            const profileData = await profileResp.json();
            logger.debug('CONFLUENCE', `Mobile profile response: ${JSON.stringify(profileData).substring(0, 500)}`);
            if (profileData.email) user.email = profileData.email;
          }
        } catch (err: any) {
          logger.debug('CONFLUENCE', `Mobile profile failed: ${err.message}`);
        }
      }

      // Approach 3: User administration page — fetch the HTML and extract email
      if (!user.email) {
        try {
          const adminResp = await this.client.get(
            this.api(`/admin/users/viewuser.action`),
            { username: user.username }
          );
          if (adminResp.ok) {
            const html = await adminResp.text();
            // Look for email patterns in the admin page HTML
            const emailMatch = html.match(/mailto:([^"'<>\s]+@[^"'<>\s]+)/);
            if (emailMatch) {
              user.email = emailMatch[1];
              logger.debug('CONFLUENCE', `Found email from admin page: ${user.email}`);
            } else {
              // Try another pattern — Confluence admin pages often have email in a table cell
              const emailMatch2 = html.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
              if (emailMatch2) {
                user.email = emailMatch2[0];
                logger.debug('CONFLUENCE', `Found email from admin page (regex): ${user.email}`);
              } else {
                logger.debug('CONFLUENCE', `Admin page HTML (first 1000 chars): ${html.substring(0, 1000)}`);
              }
            }
          }
        } catch (err: any) {
          logger.debug('CONFLUENCE', `Admin viewuser page failed: ${err.message}`);
        }
      }

      // Approach 4: JSON-RPC getUserByName
      if (!user.email) {
        const rpcUser = await this.jsonRpc('getUserByName', [user.username]);
        if (rpcUser) {
          if (rpcUser.email) user.email = rpcUser.email;
          if (rpcUser.lastLogin) user.lastLogin = rpcUser.lastLogin;
        }
      }

      // Approach 5: JSON-RPC getActiveUsers and find our user
      if (!user.email) {
        const rpcUser = await this.jsonRpc('getUser', [user.username]);
        if (rpcUser) {
          if (rpcUser.email) user.email = rpcUser.email;
          if (rpcUser.lastLogin) user.lastLogin = rpcUser.lastLogin;
        }
      }
    }

    const groups = await this.getUserGroups(user.key || user.username);
    return { ...user, groups };
  }

  async getAllGroups(): Promise<GroupInfo[]> {
    const groups: GroupInfo[] = [];
    let start = 0;
    let hasMore = true;

    while (hasMore) {
      const resp = await this.client.get(this.api('/rest/api/group'), {
        start: String(start),
        limit: '200',
      });
      if (!resp.ok) throw new Error(`Failed to load groups: ${resp.status}`);
      const data = await resp.json();
      const results = data.results || [];
      for (const g of results) {
        groups.push({ name: g.name });
      }
      if (results.length < 200) {
        hasMore = false;
      } else {
        start += 200;
      }
    }
    return groups;
  }

  async getUserGroups(identifier: string): Promise<string[]> {
    // Get user with group expansion
    let resp = await this.client.get(this.api('/rest/api/user/memberof'), {
      key: identifier,
    });
    if (!resp.ok) {
      resp = await this.client.get(this.api('/rest/api/user/memberof'), {
        username: identifier,
      });
    }
    if (!resp.ok) throw new Error(`Failed to get user groups: ${resp.status}`);
    const data = await resp.json();
    const results = data.results || [];
    return results.map((g: any) => g.name);
  }

  async addUserToGroup(identifier: string, groupName: string): Promise<void> {
    // Resolve username if identifier is a key
    const user = await this.getUserByKeyOrName(identifier);
    const username = user?.username || identifier;

    // Try JSON-RPC first (most reliable for Confluence DC)
    const result = await this.jsonRpc('addUserToGroup', [username, groupName]);
    if (result !== null) {
      logger.info('CONFLUENCE', `Added ${username} to group ${groupName} via JSON-RPC`);
      return;
    }

    // Fallback: REST API
    const resp2 = await this.client.post(
      this.api(`/rest/api/group/user?groupName=${encodeURIComponent(groupName)}`),
      { name: username }
    );
    if (resp2.ok) return;

    throw new Error(`Failed to add user to group ${groupName}`);
  }

  async removeUserFromGroup(identifier: string, groupName: string): Promise<void> {
    const user = await this.getUserByKeyOrName(identifier);
    const username = user?.username || identifier;

    // Try JSON-RPC first
    const result = await this.jsonRpc('removeUserFromGroup', [username, groupName]);
    if (result !== null) {
      logger.info('CONFLUENCE', `Removed ${username} from group ${groupName} via JSON-RPC`);
      return;
    }

    // Fallback: REST API
    const resp2 = await this.client.delete(
      this.api('/rest/api/group/user'),
      { groupName, username }
    );
    if (resp2.ok) return;

    throw new Error(`Failed to remove user from group ${groupName}`);
  }

  // Product access — not applicable for DC
  async getAllApplicationRoles(): Promise<import('../../shared/types').ApplicationRoleInfo[]> { return []; }
  async getUserApplicationRoles(_identifier: string): Promise<string[]> { return []; }
  async addUserToApplicationRole(_identifier: string, _roleKey: string): Promise<void> {
    throw new Error('Product access management is not available for Confluence Data Center');
  }
  async removeUserFromApplicationRole(_identifier: string, _roleKey: string): Promise<void> {
    throw new Error('Product access management is not available for Confluence Data Center');
  }

  async activateUser(identifier: string): Promise<void> {
    const user = await this.getUserByKeyOrName(identifier);
    const username = user?.username || identifier;

    // JSON-RPC reactivateUser is the most reliable on Confluence DC
    const result = await this.jsonRpc('reactivateUser', [username]);
    if (result !== null) {
      logger.info('CONFLUENCE', `Activated user ${username} via JSON-RPC`);
      return;
    }

    // Fallback: admin REST API
    const userKey = user?.key || identifier;
    const r1 = await this.client.put(this.api(`/rest/api/admin/user/enable?key=${encodeURIComponent(userKey)}`));
    if (r1.ok) return;

    throw new Error(`Failed to activate user ${username}`);
  }

  async deactivateUser(identifier: string): Promise<void> {
    const user = await this.getUserByKeyOrName(identifier);
    const username = user?.username || identifier;

    // JSON-RPC deactivateUser is the most reliable on Confluence DC
    const result = await this.jsonRpc('deactivateUser', [username]);
    if (result !== null) {
      logger.info('CONFLUENCE', `Deactivated user ${username} via JSON-RPC`);
      return;
    }

    // Fallback: admin REST API
    const userKey = user?.key || identifier;
    const r1 = await this.client.put(this.api(`/rest/api/admin/user/disable?key=${encodeURIComponent(userKey)}`));
    if (r1.ok) return;

    throw new Error(`Failed to deactivate user ${username}`);
  }

  async updateUserEmail(identifier: string, newEmail: string): Promise<void> {
    // Resolve to get both username and display name
    const user = await this.getUserByKeyOrName(identifier);
    const username = user?.username || identifier;
    const fullName = user?.displayName || username;

    // Confluence JSON-RPC editUser expects a single RemoteUser object (not wrapped in array
    // when using URL-based invocation). The RemoteUser fields:
    //   name (username), fullname (display name — lowercase 'n'), email
    // Try multiple field name variants since Confluence versions differ

    // Try 1: lowercase 'fullname' (standard RemoteUser)
    const result1 = await this.jsonRpc('editUser', [{
      name: username,
      fullname: fullName,
      email: newEmail,
    }]);
    if (result1 !== null) {
      logger.info('CONFLUENCE', `Updated email for ${username} via JSON-RPC editUser (fullname)`);
      return;
    }

    // Try 2: Use JSON-RPC 2.0 envelope to the base endpoint (different param format)
    try {
      const resp = await this.client.post(this.api('/rpc/json-rpc/confluenceservice-v2'), {
        jsonrpc: '2.0',
        method: 'editUser',
        params: [{ name: username, fullname: fullName, email: newEmail }],
        id: 1,
      });
      if (resp.ok) {
        const data = await resp.json();
        logger.debug('CONFLUENCE', `JSON-RPC 2.0 editUser response: ${JSON.stringify(data).substring(0, 500)}`);
        if (!data.error) {
          logger.info('CONFLUENCE', `Updated email for ${username} via JSON-RPC 2.0 editUser`);
          return;
        }
      }
    } catch (err: any) {
      logger.debug('CONFLUENCE', `JSON-RPC 2.0 editUser exception: ${err.message}`);
    }

    // Try 3: Admin page POST (form-encoded)
    try {
      const resp2 = await this.client.post(this.api('/admin/users/doedituser.action'), {
        username,
        email: newEmail,
        confirm: 'Confirm',
      });
      if (resp2.ok) {
        logger.info('CONFLUENCE', `Updated email for ${username} via admin doedituser`);
        return;
      }
      logger.debug('CONFLUENCE', `Admin doedituser failed: ${resp2.status}`);
    } catch (err: any) {
      logger.debug('CONFLUENCE', `Admin doedituser exception: ${err.message}`);
    }

    throw new Error(`Failed to update email for ${username} — no working method found`);
  }

  async updateUserName(identifier: string, newUsername: string): Promise<void> {
    // Resolve to username (identifier might be a key)
    const user = await this.getUserByKeyOrName(identifier);
    const oldUsername = user?.username || identifier;

    // JSON-RPC renameUser [oldUsername, newUsername]
    const result = await this.jsonRpc('renameUser', [oldUsername, newUsername]);
    if (result !== null) {
      logger.info('CONFLUENCE', `Renamed user ${oldUsername} → ${newUsername} via JSON-RPC`);
      return;
    }

    throw new Error(`Failed to rename user ${oldUsername} — no working method found`);
  }

  private mapUser(data: any): AtlassianUser {

    // Confluence DC status detection:
    // - `status` field: "current" = active, "deactivated" = disabled
    // - Some endpoints may return `active` boolean instead
    // - If neither is present, default to true (unknown)
    let active = true;
    if (typeof data.active === 'boolean') {
      active = data.active;
    } else if (data.status) {
      // Confluence DC uses "current" for active, "deactivated" for disabled
      active = data.status === 'current';
    }

    return {
      key: data.userKey || data.key || data.username,
      username: data.username || data.userName || '',
      displayName: data.displayName || data.fullName || '',
      // Confluence DC may use 'email', 'emailAddress', or nested in 'details'
      email: data.email || data.emailAddress || data.details?.email || '',
      active,
      lastLogin: data.lastLogin || data.lastSuccessfulLoginDate || data.lastLoginDate || undefined,
      lastUpdated: data.lastModifiedDate || data.updatedDate || undefined,
    };
  }
}
