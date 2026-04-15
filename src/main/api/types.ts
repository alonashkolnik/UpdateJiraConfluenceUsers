import type { AtlassianUser, UserDetails, GroupInfo, ApplicationRoleInfo } from '../../shared/types';

/**
 * Common interface for all Atlassian API implementations (Cloud, Jira DC, Confluence DC).
 */
export interface IAtlassianApi {
  // Current user
  getCurrentUser(): Promise<AtlassianUser>;

  // Users
  searchUsers(query: string): Promise<AtlassianUser[]>;
  getAllUsers(startAt?: number, maxResults?: number): Promise<AtlassianUser[]>;
  getUserByKeyOrName(identifier: string): Promise<AtlassianUser | null>;
  getUserDetails(identifier: string): Promise<UserDetails>;

  // Groups
  getAllGroups(): Promise<GroupInfo[]>;
  getUserGroups(identifier: string): Promise<string[]>;
  addUserToGroup(identifier: string, groupName: string): Promise<void>;
  removeUserFromGroup(identifier: string, groupName: string): Promise<void>;

  // Product access / Application roles
  getAllApplicationRoles(): Promise<ApplicationRoleInfo[]>;
  getUserApplicationRoles(identifier: string): Promise<string[]>;
  addUserToApplicationRole(identifier: string, roleKey: string): Promise<void>;
  removeUserFromApplicationRole(identifier: string, roleKey: string): Promise<void>;

  // Activate/Deactivate
  activateUser(identifier: string): Promise<void>;
  deactivateUser(identifier: string): Promise<void>;

  // Update login data
  updateUserEmail(identifier: string, newEmail: string): Promise<void>;
  updateUserName(identifier: string, newUsername: string): Promise<void>;
}
