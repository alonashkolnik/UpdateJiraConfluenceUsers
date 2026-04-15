import type { IAtlassianApi } from './types';
import type { AtlassianUser, UserDetails, GroupInfo } from '../../shared/types';
import { ApiClient } from './api-client';
import { logger } from '../logger';

/**
 * Cloud API implementation.
 * Cloud user management is centralized — works for both Jira and Confluence.
 * Uses /rest/api/3 for product-level endpoints (Jira Cloud).
 * Activate/deactivate uses the admin directory API via the product cookie session.
 */
export class CloudApi implements IAtlassianApi {
  private cloudId: string | null = null;

  constructor(private client: ApiClient) {}

  /** Get the cloud site ID, needed for admin gateway APIs */
  private async getCloudId(): Promise<string | null> {
    if (this.cloudId) return this.cloudId;
    try {
      const resp = await this.client.get('/_edge/tenant_info');
      if (resp.ok) {
        const data = await resp.json();
        this.cloudId = data.cloudId || null;
        logger.debug('CLOUD', `tenant_info: ${JSON.stringify(data)}`);
        logger.debug('CLOUD', `Cloud ID: ${this.cloudId}`);
        return this.cloudId;
      }
    } catch (err) {
      logger.debug('CLOUD', `Failed to get cloud ID: ${err}`);
    }
    return null;
  }

  async getCurrentUser(): Promise<AtlassianUser> {
    // Try Jira Cloud first
    let resp = await this.client.get('/rest/api/3/myself');
    if (!resp.ok) {
      // Maybe it's a Confluence-only URL
      resp = await this.client.get('/wiki/rest/api/user/current');
      if (!resp.ok) throw new Error('Failed to get current user');
      const data = await resp.json();
      return {
        accountId: data.accountId,
        username: data.publicName || data.displayName || '',
        displayName: data.displayName || '',
        email: data.email || '',
        active: true,
      };
    }
    const data = await resp.json();
    return {
      accountId: data.accountId,
      username: data.emailAddress || data.displayName,
      displayName: data.displayName,
      email: data.emailAddress || '',
      active: data.active,
    };
  }

  async searchUsers(query: string): Promise<AtlassianUser[]> {
    const resp = await this.client.get('/rest/api/3/user/search', {
      query,
      maxResults: '50',
      includeActive: 'true',
      includeInactive: 'true',
    });
    if (!resp.ok) throw new Error(`User search failed: ${resp.status}`);
    const data = await resp.json();
    // Filter to only real human users, consistent with getAllUsers
    return (data as any[])
      .filter(u => !u.accountType || u.accountType === 'atlassian')
      .map(this.mapCloudUser);
  }

  async getAllUsers(startAt = 0, maxResults = 100): Promise<AtlassianUser[]> {
    const allUsers: AtlassianUser[] = [];
    let start = startAt;
    let hasMore = true;

    while (hasMore) {
      const resp = await this.client.get('/rest/api/3/users/search', {
        startAt: String(start),
        maxResults: String(maxResults),
      });
      if (!resp.ok) throw new Error(`Failed to load users: ${resp.status}`);
      const data: any[] = await resp.json();

      // Filter to only real human users (exclude app accounts, bots, etc.)
      const humanUsers = data.filter(u => u.accountType === 'atlassian');
      const users = humanUsers.map(this.mapCloudUser);
      allUsers.push(...users);

      logger.debug('CLOUD', `getAllUsers page: startAt=${start} returned=${data.length} (${humanUsers.length} human)`);

      if (data.length < maxResults) {
        hasMore = false;
      } else {
        start += maxResults;
      }
    }

    logger.info('CLOUD', `getAllUsers complete: ${allUsers.length} users loaded (human accounts only)`);

    // Note: Cloud user management is organization-wide, not site-specific.
    // All users with access to any site in this Atlassian org are shown.
    return allUsers;
  }

  async getUserByKeyOrName(identifier: string): Promise<AtlassianUser | null> {
    // In Cloud, try by accountId first
    try {
      const resp = await this.client.get('/rest/api/3/user', { accountId: identifier });
      if (resp.ok) {
        const data = await resp.json();
        return this.mapCloudUser(data);
      }
    } catch { /* ignore */ }

    // Try search by email or display name
    const results = await this.searchUsers(identifier);
    if (results.length > 0) {
      return results.find(u => u.email.toLowerCase() === identifier.toLowerCase() || u.username.toLowerCase() === identifier.toLowerCase()) || results[0];
    }
    return null;
  }

  async getUserDetails(identifier: string): Promise<UserDetails> {
    const user = await this.getUserByKeyOrName(identifier);
    if (!user) throw new Error(`User not found: ${identifier}`);

    const groups = await this.getUserGroups(user.accountId || identifier);
    const applicationRoles = await this.getUserApplicationRoles(user.accountId || identifier);
    return { ...user, groups, applicationRoles };
  }

  async getAllGroups(): Promise<GroupInfo[]> {
    const groups: GroupInfo[] = [];
    let start = 0;
    let hasMore = true;

    while (hasMore) {
      const resp = await this.client.get('/rest/api/3/group/bulk', {
        startAt: String(start),
        maxResults: '100',
      });
      if (!resp.ok) throw new Error(`Failed to load groups: ${resp.status}`);
      const data = await resp.json();
      const values = data.values || data || [];
      for (const g of values) {
        groups.push({ name: g.name, memberCount: g.memberCount });
      }
      hasMore = data.isLast === false;
      start += 100;
    }
    return groups;
  }

  async getUserGroups(identifier: string): Promise<string[]> {
    const resp = await this.client.get('/rest/api/3/user/groups', { accountId: identifier });
    if (!resp.ok) throw new Error(`Failed to get user groups: ${resp.status}`);
    const data: any[] = await resp.json();
    return data.map((g: any) => g.name);
  }

  async addUserToGroup(identifier: string, groupName: string): Promise<void> {
    // Cloud uses query params for group name
    const resp = await this.client.post(`/rest/api/3/group/user?groupname=${encodeURIComponent(groupName)}`, {
      accountId: identifier,
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Failed to add user to group ${groupName}: ${err}`);
    }
  }

  async removeUserFromGroup(identifier: string, groupName: string): Promise<void> {
    const resp = await this.client.delete(`/rest/api/3/group/user?groupname=${encodeURIComponent(groupName)}&accountId=${encodeURIComponent(identifier)}`);
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Failed to remove user from group ${groupName}: ${err}`);
    }
  }

  // ─── Product Access / Application Roles ─────────────────────

  /** Map Atlassian admin hub productKey/productId to friendly display names */
  private static PRODUCT_NAMES: Record<string, string> = {
    'project': 'Jira',
    'jira-software': 'Jira Software',
    'jira-servicedesk': 'Jira Service Management',
    'jira-product-discovery': 'Jira Product Discovery',
    'jira-admin': 'Jira Administration',
    'confluence': 'Confluence',
    'conf': 'Confluence',
    'compass': 'Compass',
    'assets': 'Assets',
    'goal': 'Goals',
    'goals': 'Goals',
    'atlas': 'Atlas',
    'townsquare': 'Atlas',
    'guard': 'Guard',
    'access': 'Guard',
    'analytics': 'Analytics',
    'loom': 'Loom',
    'halp': 'Halp',
    'statuspage': 'Statuspage',
    'opsgenie': 'Opsgenie',
    'trello': 'Trello',
    'bitbucket': 'Bitbucket',
  };

  /** Resolve a productKey to a friendly name */
  private resolveProductName(product: any): string {
    const key = product.productKey || product.productId || product.key || '';
    // First try explicit name fields from the API
    if (product.name && product.name !== key) return product.name;
    if (product.productName && product.productName !== key) return product.productName;
    if (product.displayName && product.displayName !== key) return product.displayName;
    // Then map known keys
    const mapped = CloudApi.PRODUCT_NAMES[key];
    if (mapped) return mapped;
    // Last resort: capitalize the key
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  /** Format a role slug like "product/admin" → "Admin" */
  private static formatRoleLabel(role: string): string {
    const parts = role.split('/');
    const label = parts[parts.length - 1];
    return label.charAt(0).toUpperCase() + label.slice(1).replace(/-/g, ' ');
  }

  /**
   * Get all available products/application roles across ALL sites in the org.
   * Uses admin hub gateway, querying each discovered site.
   * Returns one entry per product per workspace (site), so multi-site orgs get separate entries.
   */
  async getAllApplicationRoles(): Promise<import('../../shared/types').ApplicationRoleInfo[]> {
    const allRoles: import('../../shared/types').ApplicationRoleInfo[] = [];
    // Use composite key "productKey:workspaceId" to allow same product across sites
    const seenComposite = new Set<string>();

    const cloudId = await this.getCloudId();
    const siteIds = cloudId ? [cloudId] : [];

    // 1) Query each site's products via admin hub gateway
    for (const siteId of siteIds) {
      try {
        const endpoint = `/gateway/api/adminhub/um/site/${siteId}/products`;
        const resp = await this.client.get(endpoint);
        if (resp.ok) {
          const data = await resp.json();
          const products = Array.isArray(data) ? data : (data.products || data.data || []);
          for (const p of products) {
            const key = p.productKey || p.productId || p.key || '';
            const workspaceId = p.workspaceId || siteId;
            const workspaceName = p.workspaceName || p.hostName?.replace('.atlassian.net', '') || '';
            const compositeKey = `${key}:${workspaceId}`;
            const name = this.resolveProductName(p);
            const availableRoles = (p.availableRoles || []) as string[];
            if (key && !seenComposite.has(compositeKey)) {
              seenComposite.add(compositeKey);
              allRoles.push({
                key,
                name,
                userCount: p.userCount || p.seatCount,
                availableRoles,
                workspaceName,
                workspaceId,
              });
            }
          }
          logger.debug('CLOUD', `getAllApplicationRoles site ${siteId}: ${products.length} products`);
        }
      } catch (err) {
        logger.debug('CLOUD', `getAllApplicationRoles site ${siteId} failed: ${err}`);
      }
    }

    logger.debug('CLOUD', `Products: ${JSON.stringify(allRoles.map(r => ({ key: r.key, name: r.name, workspace: r.workspaceName, roles: r.availableRoles })))}`);

    // 2) Also try the Jira REST API to fill in any Jira-specific roles not covered by admin hub
    // Build a set of product keys already discovered via admin hub
    const adminHubKeys = new Set(allRoles.map(r => r.key));
    try {
      const resp = await this.client.get('/rest/api/3/applicationrole');
      if (resp.ok) {
        const data: any[] = await resp.json();
        for (const r of data) {
          const key = r.key || '';
          // Skip if admin hub already has this product (it has richer data with availableRoles)
          if (key && !adminHubKeys.has(key)) {
            adminHubKeys.add(key);
            allRoles.push({ key, name: r.name || key, userCount: r.numberOfSeats });
          }
        }
      }
    } catch (err) {
      logger.debug('CLOUD', `getAllApplicationRoles Jira REST failed: ${err}`);
    }

    logger.info('CLOUD', `getAllApplicationRoles total: ${allRoles.length} products: ${allRoles.map(r => `${r.name}${r.workspaceName ? ` (${r.workspaceName})` : ''}`).join(', ')}`);
    return allRoles;
  }

  /**
   * Get a user's product access with roles across ALL sites.
   * Returns display strings like "Jira — payroc (Admin)" or "Confluence — sandbox (Member)".
   */
  async getUserApplicationRoles(identifier: string): Promise<string[]> {
    const results: string[] = [];
    const seen = new Set<string>();

    const cloudId = await this.getCloudId();
    const siteIds = cloudId ? [cloudId] : [];

    // Query each site for this user's product access
    // Returns ONE ENTRY PER ROLE (not per product) for granular management
    for (const siteId of siteIds) {
      try {
        const endpoint = `/gateway/api/adminhub/um/site/${siteId}/users/${identifier}/products`;
        const resp = await this.client.get(endpoint);
        if (resp.ok) {
          const data = await resp.json();
          const products = Array.isArray(data) ? data : (data.products || data.data || []);
          for (const p of products) {
            const name = this.resolveProductName(p);
            const workspaceName = p.workspaceName || p.hostName?.replace('.atlassian.net', '') || '';
            const productKey = p.productKey || p.productId || p.key || '';
            const roles = p.roles || [];
            if (roles.length > 0) {
              // One entry per role
              for (const role of roles) {
                const roleLabel = CloudApi.formatRoleLabel(role);
                // Format: "ProductName (Role) [productKey|role]"
                // The [key|role] suffix is hidden metadata for mapping back to API keys
                const display = `${name} (${roleLabel}) [${productKey}|${role}]`;
                const compositeKey = `${productKey}:${role}`;
                if (!seen.has(compositeKey)) {
                  seen.add(compositeKey);
                  results.push(display);
                }
              }
            } else {
              // No roles — just show the product
              const display = `${name} [${productKey}|]`;
              if (!seen.has(productKey)) {
                seen.add(productKey);
                results.push(display);
              }
            }
          }
        }
      } catch (err) {
        logger.debug('CLOUD', `getUserApplicationRoles site ${siteId} failed: ${err}`);
      }
    }

    if (results.length > 0) {
      logger.debug('CLOUD', `getUserApplicationRoles: ${results.length} role entries for ${identifier} across ${siteIds.length} sites`);
      return results;
    }

    // 2) Fallback: Jira REST API expand=applicationRoles (only Jira roles)
    try {
      const resp = await this.client.get('/rest/api/3/user', {
        accountId: identifier,
        expand: 'applicationRoles',
      });
      if (resp.ok) {
        const data = await resp.json();
        const items = data.applicationRoles?.items || data.applicationRoles || [];
        for (const r of items) {
          const name = r.name || r.key || r;
          if (typeof name === 'string' && !seen.has(name)) {
            seen.add(name);
            results.push(name);
          }
        }
      }
    } catch (err) {
      logger.debug('CLOUD', `getUserApplicationRoles Jira fallback failed: ${err}`);
    }

    return results;
  }

  /**
   * Grant a user product access.
   * roleKey can be:
   *   - "productKey|role" (e.g. "project|product/member") — grants specific role
   *   - "productKey" (e.g. "project") — grants default role (product/member)
   */
  async addUserToApplicationRole(identifier: string, roleKey: string): Promise<void> {
    // Parse compound format "productKey|role"
    const [productKey, role] = roleKey.includes('|')
      ? roleKey.split('|', 2)
      : [roleKey, 'product/member'];

    const cloudId = await this.getCloudId();

    // 1) Try admin hub gateway with role
    if (cloudId) {
      try {
        const endpoint = `/gateway/api/adminhub/um/site/${cloudId}/users/${identifier}/products/${encodeURIComponent(productKey)}/access`;
        const resp = await this.client.put(endpoint, {
          roles: [role],
        });
        if (resp.ok) {
          logger.info('CLOUD', `Granted ${productKey} (${role}) to ${identifier} via admin hub`);
          return;
        }
        const body = await resp.text().catch(() => '');
        logger.debug('CLOUD', `Admin hub grant → ${resp.status}: ${body.substring(0, 200)}`);
      } catch (err) {
        logger.debug('CLOUD', `Admin hub grant failed: ${err}`);
      }
    }

    // 2) Try Jira REST applicationrole endpoint
    const resp = await this.client.post(`/rest/api/3/applicationrole/${encodeURIComponent(productKey)}/user`, {
      accountId: identifier,
    });
    if (resp.ok) {
      logger.info('CLOUD', `Added ${identifier} to role ${productKey} via Jira REST`);
      return;
    }

    // 3) Fallback: adminhub manage endpoint
    const resp2 = await this.client.put(`/gateway/api/adminhub/um/user/${identifier}/manage/product-access`, {
      products: [productKey],
      roles: [role],
      action: 'grant',
    });
    if (resp2.ok) {
      logger.info('CLOUD', `Granted ${productKey} (${role}) to ${identifier} via adminhub manage`);
      return;
    }

    const err = await resp.text().catch(() => `${resp.status}`);
    throw new Error(`Failed to grant product access ${productKey} (${role}): ${err}`);
  }

  /**
   * Revoke a user's product access.
   * roleKey can be "productKey|role" or just "productKey".
   */
  async removeUserFromApplicationRole(identifier: string, roleKey: string): Promise<void> {
    const [productKey, role] = roleKey.includes('|')
      ? roleKey.split('|', 2)
      : [roleKey, ''];

    const cloudId = await this.getCloudId();

    // 1) Try admin hub gateway
    if (cloudId) {
      try {
        const endpoint = `/gateway/api/adminhub/um/site/${cloudId}/users/${identifier}/products/${encodeURIComponent(productKey)}/access`;
        const resp = await this.client.delete(endpoint);
        if (resp.ok) {
          logger.info('CLOUD', `Revoked ${productKey}${role ? ` (${role})` : ''} from ${identifier} via admin hub`);
          return;
        }
        logger.debug('CLOUD', `Admin hub revoke → ${resp.status}`);
      } catch (err) {
        logger.debug('CLOUD', `Admin hub revoke failed: ${err}`);
      }
    }

    // 2) Try Jira REST
    const resp = await this.client.delete(`/rest/api/3/applicationrole/${encodeURIComponent(productKey)}/user?accountId=${encodeURIComponent(identifier)}`);
    if (resp.ok) {
      logger.info('CLOUD', `Removed ${identifier} from role ${productKey} via Jira REST`);
      return;
    }

    // 3) Fallback
    const resp2 = await this.client.put(`/gateway/api/adminhub/um/user/${identifier}/manage/product-access`, {
      products: [productKey],
      action: 'revoke',
    });
    if (resp2.ok) {
      logger.info('CLOUD', `Revoked ${productKey} from ${identifier} via adminhub manage`);
      return;
    }

    const err = await resp.text().catch(() => `${resp.status}`);
    throw new Error(`Failed to revoke product access ${productKey}: ${err}`);
  }

  async activateUser(identifier: string): Promise<void> {
    // Cloud: user lifecycle management is org-wide via admin gateway
    // Try multiple known endpoint patterns
    const endpoints = [
      `/gateway/api/adminhub/um/user/${identifier}/manage/lifecycle/enable`,
      `/gateway/api/directory/v1/user/${identifier}/lifecycle/enable`,
      `/gateway/api/adminhub/um/user/${identifier}/enable`,
    ];

    for (const endpoint of endpoints) {
      const resp = await this.client.post(endpoint);
      const body = await resp.text().catch(() => '');
      logger.debug('CLOUD', `activateUser ${endpoint} → ${resp.status} body=${body.substring(0, 200)}`);
      if (resp.ok && !body.includes('<!DOCTYPE') && !body.includes('<html')) {
        // Verify the user is actually active now
        const check = await this.client.get('/rest/api/3/user', { accountId: identifier });
        if (check.ok) {
          const userData = await check.json();
          if (userData.active === true) {
            logger.info('CLOUD', `User ${identifier} successfully activated via ${endpoint}`);
            return;
          }
          logger.warn('CLOUD', `${endpoint} returned OK but user still inactive`);
        }
      }
    }

    throw new Error('Failed to activate user on this site. If the user is disabled at the organization/domain level, they must be re-enabled in Atlassian Admin (admin.atlassian.com) first.');
  }

  async deactivateUser(identifier: string): Promise<void> {
    const endpoints = [
      `/gateway/api/adminhub/um/user/${identifier}/manage/lifecycle/disable`,
      `/gateway/api/directory/v1/user/${identifier}/lifecycle/disable`,
      `/gateway/api/adminhub/um/user/${identifier}/disable`,
    ];

    for (const endpoint of endpoints) {
      const resp = await this.client.post(endpoint);
      const body = await resp.text().catch(() => '');
      logger.debug('CLOUD', `deactivateUser ${endpoint} → ${resp.status} body=${body.substring(0, 200)}`);
      if (resp.ok && !body.includes('<!DOCTYPE') && !body.includes('<html')) {
        const check = await this.client.get('/rest/api/3/user', { accountId: identifier });
        if (check.ok) {
          const userData = await check.json();
          if (userData.active === false) {
            logger.info('CLOUD', `User ${identifier} successfully deactivated via ${endpoint}`);
            return;
          }
          logger.warn('CLOUD', `${endpoint} returned OK but user still active`);
        }
      }
    }

    throw new Error('Failed to deactivate user on this site. If the user is managed at the organization/domain level, changes must be made in Atlassian Admin (admin.atlassian.com).');
  }

  async updateUserEmail(identifier: string, newEmail: string): Promise<void> {
    // Cloud: update email via Jira REST API (PUT /rest/api/3/user with accountId)
    // Try 1: Jira Cloud user endpoint
    const resp = await this.client.put(`/rest/api/3/user?accountId=${encodeURIComponent(identifier)}`, {
      emailAddress: newEmail,
    });
    if (resp.ok) {
      logger.info('CLOUD', `Updated email for ${identifier} via Jira REST API`);
      return;
    }
    logger.debug('CLOUD', `Jira REST email update failed: ${resp.status}`);

    // Try 2: Admin hub gateway
    const resp2 = await this.client.put(`/gateway/api/adminhub/um/user/${identifier}/manage/email`, {
      email: newEmail,
    });
    if (resp2.ok) {
      logger.info('CLOUD', `Updated email for ${identifier} via adminhub`);
      return;
    }
    logger.debug('CLOUD', `Adminhub email update failed: ${resp2.status}`);

    // Try 3: User properties
    const resp3 = await this.client.put(`/rest/api/3/user/email?accountId=${encodeURIComponent(identifier)}`, {
      email: newEmail,
    });
    if (resp3.ok) {
      logger.info('CLOUD', `Updated email for ${identifier} via user/email endpoint`);
      return;
    }

    const err = await resp.text().catch(() => `${resp.status}`);
    throw new Error(`Failed to update email: ${err}`);
  }

  async updateUserName(_identifier: string, _newUsername: string): Promise<void> {
    // Cloud does not have a traditional "username" — users are identified by accountId.
    // Display name changes can only be made by the user themselves via their Atlassian account.
    throw new Error('Username changes are not supported for Cloud instances. Cloud users are identified by accountId, not username.');
  }

  private mapCloudUser(data: any): AtlassianUser {
    return {
      accountId: data.accountId,
      username: data.emailAddress || data.displayName || data.name || '',
      displayName: data.displayName || '',
      email: data.emailAddress || '',
      active: data.active ?? true,
      lastLogin: data.last_active || data.lastActive || undefined,
      lastUpdated: data.updated || data.updatedAt || undefined,
    };
  }
}
