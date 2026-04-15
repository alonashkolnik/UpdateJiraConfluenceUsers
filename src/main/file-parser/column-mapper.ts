import type { BulkRow, BulkError, ParseResult } from '../../shared/types';

// Canonical column name → list of accepted aliases (all lowercase)
const COLUMN_ALIASES: Record<string, string[]> = {
  userKey: ['userkey', 'user_key', 'key', 'accountid', 'account_id'],
  userName: [
    'username', 'user_name', 'old_username', 'oldusername',
    'login', 'name', 'user',
  ],
  email: [
    'email', 'oldemail', 'old_email', 'mail',
    'emailaddress', 'email_address', 'e-mail',
  ],
  newUserName: [
    'newusername', 'new_username', 'new_user_name',
    'newlogin', 'new_login', 'newname', 'new_name',
  ],
  newEmail: [
    'newemail', 'new_email', 'new_mail',
    'newemailaddress', 'new_email_address', 'new_e-mail',
  ],
  addGroups: [
    'addgroups', 'add_groups', 'groups_to_add',
    'newgroups', 'new_groups', 'addgroup', 'add_group',
  ],
  removeGroups: [
    'removegroups', 'remove_groups', 'groups_to_remove',
    'deletegroups', 'delete_groups', 'removegroup', 'remove_group',
  ],
  addProducts: [
    'addproduct', 'add_product', 'addproducts', 'add_products',
    'products_to_add', 'grantproduct', 'grant_product',
    'addrole', 'add_role', 'addroles', 'add_roles',
    'addaccess', 'add_access', 'grantaccess', 'grant_access',
  ],
  removeProducts: [
    'removeproduct', 'remove_product', 'removeproducts', 'remove_products',
    'products_to_remove', 'revokeproduct', 'revoke_product',
    'removerole', 'remove_role', 'removeroles', 'remove_roles',
    'removeaccess', 'remove_access', 'revokeaccess', 'revoke_access',
  ],
  newStatus: [
    'newstatus', 'new_status', 'new_state',
    'setstatus', 'set_status', 'targetstatus', 'target_status',
  ],
};

/** Normalize a header string for matching */
function normalize(header: string): string {
  return header.toLowerCase().replace(/[\s_\-]+/g, '').trim();
}

/** Map actual headers to canonical column names */
export function mapColumns(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}; // canonical → actual header

  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const header of headers) {
      const normalizedHeader = normalize(header);
      for (const alias of aliases) {
        if (normalizedHeader === normalize(alias)) {
          mapping[canonical] = header;
          break;
        }
      }
      if (mapping[canonical]) break;
    }
  }

  return mapping;
}

/** Parse a status value from various string representations */
function parseStatus(value: string): 'active' | 'inactive' | null {
  const v = value.toLowerCase().trim();
  if (['active', 'true', 'yes', 'enable', 'enabled', '1'].includes(v)) return 'active';
  if (['inactive', 'false', 'no', 'disable', 'disabled', '0', 'deactivated'].includes(v)) return 'inactive';
  return null;
}

/** Parse a comma/semicolon-separated list of group names */
function parseGroupList(value: string): string[] {
  if (!value || !value.trim()) return [];
  return value
    .split(/[,;|]/)
    .map(g => g.trim())
    .filter(g => g.length > 0);
}

/** Simple email validation */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Convert raw parsed rows (array of key-value objects) into BulkRows with validation */
export function processRows(
  rawRows: Record<string, string>[],
  columnMapping: Record<string, string>
): { rows: BulkRow[]; errors: BulkError[] } {
  const rows: BulkRow[] = [];
  const errors: BulkError[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowIndex = i + 2; // +2 for 1-based index + header row

    const getValue = (canonical: string): string => {
      const actualHeader = columnMapping[canonical];
      if (!actualHeader) return '';
      return (raw[actualHeader] || '').trim();
    };

    const emailVal = getValue('email');
    const userKeyVal = getValue('userKey');
    const userNameVal = getValue('userName');
    const newUserNameVal = getValue('newUserName');
    const newEmailVal = getValue('newEmail');
    const addGroupsVal = getValue('addGroups');
    const removeGroupsVal = getValue('removeGroups');
    const addProductsVal = getValue('addProducts');
    const removeProductsVal = getValue('removeProducts');
    const newStatusVal = getValue('newStatus');

    // Email is required to identify the user (if no userKey and no userName)
    if (!emailVal && !userKeyVal && !userNameVal) {
      errors.push({
        rowIndex,
        column: 'email',
        message: 'At least one of Email, UserKey, or UserName is required to identify the user',
        severity: 'error',
      });
      rows.push({ rowIndex, email: '' });
      continue;
    }

    // Validate email format if provided
    if (emailVal && !isValidEmail(emailVal)) {
      errors.push({
        rowIndex,
        column: 'email',
        message: `Invalid email format: "${emailVal}"`,
        severity: 'warning',
      });
    }

    // Validate new email if column exists and is populated
    if (columnMapping['newEmail'] && newEmailVal && !isValidEmail(newEmailVal)) {
      errors.push({
        rowIndex,
        column: 'newEmail',
        message: `Invalid new email format: "${newEmailVal}"`,
        severity: 'error',
      });
    }

    // Validate status value
    let parsedStatus: 'active' | 'inactive' | undefined;
    if (newStatusVal) {
      const s = parseStatus(newStatusVal);
      if (s === null) {
        errors.push({
          rowIndex,
          column: 'newStatus',
          message: `Invalid status value: "${newStatusVal}". Expected: active/inactive/enable/disable/true/false`,
          severity: 'error',
        });
      } else {
        parsedStatus = s;
      }
    }

    const row: BulkRow = {
      rowIndex,
      userKey: userKeyVal || undefined,
      userName: userNameVal || undefined,
      email: emailVal,
      newUserName: newUserNameVal || undefined,
      newEmail: newEmailVal || undefined,
      addGroups: parseGroupList(addGroupsVal),
      removeGroups: parseGroupList(removeGroupsVal),
      addProducts: parseGroupList(addProductsVal),
      removeProducts: parseGroupList(removeProductsVal),
      newStatus: parsedStatus,
    };

    rows.push(row);
  }

  return { rows, errors };
}

/** Validate that required columns exist for a given action */
export function validateColumnsForAction(
  columnMapping: Record<string, string>,
  action: 'activate-deactivate' | 'update-groups' | 'update-login' | 'update-product-access',
  rows: BulkRow[]
): BulkError[] {
  const errors: BulkError[] = [];

  switch (action) {
    case 'activate-deactivate':
      if (!columnMapping['newStatus']) {
        errors.push({
          rowIndex: 0,
          column: 'newStatus',
          message: 'File must contain a "NewStatus" (or "Status"/"Active") column for activate/deactivate action',
          severity: 'error',
        });
      } else {
        // Check that at least some rows have status populated
        const populated = rows.filter(r => r.newStatus);
        if (populated.length === 0) {
          errors.push({
            rowIndex: 0,
            column: 'newStatus',
            message: 'No rows have a populated NewStatus value',
            severity: 'error',
          });
        }
      }
      break;

    case 'update-groups':
      if (!columnMapping['addGroups'] && !columnMapping['removeGroups']) {
        errors.push({
          rowIndex: 0,
          column: 'addGroups/removeGroups',
          message: 'File must contain at least one of "AddGroups" or "RemoveGroups" columns',
          severity: 'error',
        });
      } else {
        // Check that at least some rows have groups data
        const hasGroupData = rows.some(r =>
          (r.addGroups && r.addGroups.length > 0) ||
          (r.removeGroups && r.removeGroups.length > 0)
        );
        if (!hasGroupData) {
          errors.push({
            rowIndex: 0,
            column: 'addGroups/removeGroups',
            message: 'No rows have populated AddGroups or RemoveGroups values',
            severity: 'error',
          });
        }
      }
      break;

    case 'update-login':
      if (!columnMapping['email']) {
        errors.push({
          rowIndex: 0,
          column: 'email',
          message: 'File must contain an "Email" (or "OldEmail") column',
          severity: 'error',
        });
      }
      if (!columnMapping['newEmail']) {
        errors.push({
          rowIndex: 0,
          column: 'newEmail',
          message: 'File must contain a "NewEmail" column for login data update',
          severity: 'error',
        });
      } else {
        // Validate that newEmail is populated for each row
        for (const row of rows) {
          if (!row.newEmail) {
            errors.push({
              rowIndex: row.rowIndex,
              column: 'newEmail',
              message: 'NewEmail is required for login data update but is empty',
              severity: 'error',
            });
          }
        }
      }
      break;

    case 'update-product-access':
      if (!columnMapping['addProducts'] && !columnMapping['removeProducts']) {
        errors.push({
          rowIndex: 0,
          column: 'addProducts/removeProducts',
          message: 'File must contain at least one of "AddProduct" or "RemoveProduct" columns',
          severity: 'error',
        });
      } else {
        const hasProductData = rows.some(r =>
          (r.addProducts && r.addProducts.length > 0) ||
          (r.removeProducts && r.removeProducts.length > 0)
        );
        if (!hasProductData) {
          errors.push({
            rowIndex: 0,
            column: 'addProducts/removeProducts',
            message: 'No rows have populated AddProduct or RemoveProduct values',
            severity: 'error',
          });
        }
      }
      break;
  }

  return errors;
}
