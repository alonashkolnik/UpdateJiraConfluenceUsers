import React, { useState, useMemo } from 'react';
import { useUserStore } from '../../store/user-store';
import { useActionStore } from '../../store/action-store';
import { useAppStore } from '../../store/app-store';
import type { SummaryItem, SkippedItem, ChangeLine, ApplicationRoleInfo } from '../../../shared/types';

/**
 * Role strings from the API have the format:
 *   "ProductName (RoleLabel) [productKey|role]"
 * The [productKey|role] suffix is hidden metadata for mapping to API keys.
 */
function parseRoleString(roleStr: string): { display: string; productKey: string; role: string; productLabel: string; roleLabel: string } {
  const bracketMatch = roleStr.match(/\s*\[([^\]]*)\]\s*$/);
  const display = bracketMatch ? roleStr.replace(bracketMatch[0], '').trim() : roleStr;

  let productKey = '';
  let role = '';
  if (bracketMatch) {
    const parts = bracketMatch[1].split('|', 2);
    productKey = parts[0] || '';
    role = parts[1] || '';
  }

  // Extract product label and role label from display
  const parenMatch = display.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const productLabel = parenMatch ? parenMatch[1].trim() : display;
  const roleLabel = parenMatch ? parenMatch[2].trim() : '';

  return { display, productKey, role, productLabel, roleLabel };
}

function formatRoleLabel(role: string): string {
  const parts = role.split('/');
  const label = parts[parts.length - 1];
  return label.charAt(0).toUpperCase() + label.slice(1).replace(/-/g, ' ');
}

export function UpdateProductAccessPanel() {
  const { mode, selectedUser, bulkData, skippedRows, allApplicationRoles } = useUserStore();
  const instanceType = useAppStore((s) => s.instanceType);
  const {
    rolesToAdd,
    setRolesToAdd,
    rolesToRemove,
    setRolesToRemove,
    setSummary,
    setExecutionPhase,
    executionPhase,
  } = useActionStore();

  const [showAddPopup, setShowAddPopup] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ApplicationRoleInfo | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [checkedRoles, setCheckedRoles] = useState<Set<string>>(new Set());

  // Parse current roles into structured entries
  const currentRoleEntries = useMemo(() => {
    if (mode !== 'single' || !selectedUser) return [];
    return (selectedUser.applicationRoles || []).map(r => parseRoleString(r));
  }, [mode, selectedUser]);

  // Group current roles by product for display
  const currentRolesByProduct = useMemo(() => {
    const groups: Record<string, typeof currentRoleEntries> = {};
    for (const entry of currentRoleEntries) {
      if (!groups[entry.productLabel]) groups[entry.productLabel] = [];
      groups[entry.productLabel].push(entry);
    }
    return groups;
  }, [currentRoleEntries]);

  // Parse rolesToAdd compound values into display entries
  const addEntries = useMemo(() => {
    return rolesToAdd.map(compound => {
      const [productKey, role] = compound.includes('|') ? compound.split('|', 2) : [compound, ''];
      const product = allApplicationRoles.find(r => r.key === productKey);
      const productName = product?.name || productKey;
      const roleLabel = role ? formatRoleLabel(role) : '';
      const display = roleLabel ? `${productName} (${roleLabel})` : productName;
      return { productKey, productName, role, roleLabel, compound, display };
    });
  }, [rolesToAdd, allApplicationRoles]);

  // Products available to add = all products, but only showing roles not already assigned
  const availableProducts = useMemo(() => {
    // Build set of "productKey|role" that user already has
    const existingRoles = new Set(
      currentRoleEntries.map(e => `${e.productKey}|${e.role}`)
    );
    // Also include roles already queued for addition
    const addedCompounds = new Set(rolesToAdd);

    return allApplicationRoles.filter(r => {
      const roles = r.availableRoles || [];
      // Show product if it has at least one role that is NOT already assigned and NOT already queued
      const hasUnassignedRole = roles.some(role => {
        const compound = `${r.key}|${role}`;
        return !existingRoles.has(compound) && !addedCompounds.has(compound);
      });
      return hasUnassignedRole;
    });
  }, [currentRoleEntries, allApplicationRoles, rolesToAdd]);

  // Filtered products for search
  const filteredProducts = useMemo(() => {
    if (!productSearch) return availableProducts;
    const q = productSearch.toLowerCase();
    return availableProducts.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.key.toLowerCase().includes(q)
    );
  }, [availableProducts, productSearch]);

  // Roles for the selected product: filter out already assigned + already queued
  const availableRolesForSelected = useMemo(() => {
    if (!selectedProduct) return [];
    const existingRoles = new Set(
      currentRoleEntries.map(e => `${e.productKey}|${e.role}`)
    );
    const addedCompounds = new Set(rolesToAdd);
    return (selectedProduct.availableRoles || []).filter(role => {
      const compound = `${selectedProduct.key}|${role}`;
      return !existingRoles.has(compound) && !addedCompounds.has(compound);
    });
  }, [selectedProduct, currentRoleEntries, rolesToAdd]);

  const handleSelectProduct = (product: ApplicationRoleInfo) => {
    // Count available (unassigned) roles for this product
    const existingRoles = new Set(
      currentRoleEntries.map(e => `${e.productKey}|${e.role}`)
    );
    const addedCompounds = new Set(rolesToAdd);
    const unassignedRoles = (product.availableRoles || []).filter(role => {
      const compound = `${product.key}|${role}`;
      return !existingRoles.has(compound) && !addedCompounds.has(compound);
    });

    if (unassignedRoles.length <= 1) {
      const role = unassignedRoles[0] || 'product/member';
      const compound = `${product.key}|${role}`;
      if (!rolesToAdd.includes(compound)) {
        setRolesToAdd([...rolesToAdd, compound]);
      }
      setSelectedProduct(null);
      setCheckedRoles(new Set());
    } else {
      setSelectedProduct(product);
      setCheckedRoles(new Set());
    }
  };

  const toggleRoleCheck = (role: string) => {
    setCheckedRoles(prev => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const handleConfirmRoles = () => {
    if (!selectedProduct || checkedRoles.size === 0) return;
    const newRoles = Array.from(checkedRoles).map(role => `${selectedProduct.key}|${role}`);
    const merged = [...rolesToAdd, ...newRoles.filter(r => !rolesToAdd.includes(r))];
    setRolesToAdd(merged);
    setSelectedProduct(null);
    setCheckedRoles(new Set());
  };

  // Toggle a specific role entry for removal (using the raw API string as key)
  const toggleRemoveRole = (rawRoleStr: string) => {
    if (rolesToRemove.includes(rawRoleStr)) {
      setRolesToRemove(rolesToRemove.filter((r) => r !== rawRoleStr));
    } else {
      setRolesToRemove([...rolesToRemove, rawRoleStr]);
    }
  };

  const generateSummary = (): { items: SummaryItem[]; skipped: SkippedItem[] } => {
    const items: SummaryItem[] = [];
    const skipped: SkippedItem[] = [];

    if (mode === 'single' && selectedUser) {
      const userId = selectedUser.key || selectedUser.accountId || selectedUser.username;
      const changes: ChangeLine[] = [];
      const rawRoles = selectedUser.applicationRoles || [];

      const removeSet = new Set(rolesToRemove);
      for (const rawStr of rawRoles) {
        const parsed = parseRoleString(rawStr);
        if (removeSet.has(rawStr)) {
          changes.push({ type: 'remove-role', label: parsed.display });
        } else {
          changes.push({ type: 'keep-role', label: parsed.display });
        }
      }
      for (const entry of addEntries) {
        changes.push({ type: 'add-role', label: entry.display });
      }

      items.push({
        userIdentifier: userId,
        displayName: selectedUser.displayName,
        fullName: selectedUser.displayName,
        username: selectedUser.username,
        email: selectedUser.email,
        lastLogin: selectedUser.lastLogin,
        lastUpdated: selectedUser.lastUpdated,
        changes,
      });
    } else if (mode === 'bulk') {
      // Build case-insensitive lookup for known product keys/names
      const knownProductsMap = new Map<string, string>();
      for (const r of allApplicationRoles) {
        knownProductsMap.set(r.key.toLowerCase(), r.name);
        knownProductsMap.set(r.name.toLowerCase(), r.name);
      }

      for (const row of bulkData) {
        const userId = row.resolvedUser?.key || row.resolvedUser?.accountId || row.userName || row.email;
        const displayName = row.resolvedUser?.displayName || row.userName || row.email;

        if (skippedRows.has(row.rowIndex)) {
          skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: 'Manually skipped by user' });
          continue;
        }
        if (row.resolveError) {
          skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: `User not found in instance: ${row.resolveError}` });
          continue;
        }

        const hasAdd = row.addProducts && row.addProducts.length > 0;
        const hasRemove = row.removeProducts && row.removeProducts.length > 0;
        if (!hasAdd && !hasRemove) {
          skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: 'No AddProduct or RemoveProduct values set for this row' });
          continue;
        }

        const changes: ChangeLine[] = [];
        const warnings: string[] = [];

        // Parse user's current roles into compound keys for "already has" checks
        const currentRoleKeys = new Set<string>();
        for (const r of row.resolvedUser?.applicationRoles || []) {
          const bracketMatch = r.match(/\[([^\]]*)\]\s*$/);
          if (bracketMatch) {
            currentRoleKeys.add(bracketMatch[1].toLowerCase());
          }
        }

        // Show current roles as keep-role
        if (currentRoleKeys.size > 0 && row.resolvedUser?.applicationRoles) {
          for (const r of row.resolvedUser.applicationRoles) {
            const bracketMatch = r.match(/\[([^\]]*)\]\s*$/);
            const display = bracketMatch ? r.replace(bracketMatch[0], '').trim() : r;
            const compoundKey = bracketMatch ? bracketMatch[1].toLowerCase() : '';
            // Check if this role is being removed
            const isBeingRemoved = (row.removeProducts || []).some(rp => {
              const [namePart, role] = rp.includes('|') ? rp.split('|', 2) : [rp, ''];
              const rpKey = `${namePart.toLowerCase()}|${role.toLowerCase()}`;
              return rpKey === compoundKey;
            });
            if (isBeingRemoved) {
              changes.push({ type: 'remove-role', label: display });
            } else {
              changes.push({ type: 'keep-role', label: display });
            }
          }
        }

        // Products to add — validate and check duplicates
        for (const r of row.addProducts || []) {
          const [namePart, role] = r.includes('|') ? r.split('|', 2) : [r, ''];
          const compoundKey = `${namePart.toLowerCase()}|${(role || '').toLowerCase()}`;
          // Validate product exists
          if (knownProductsMap.size > 0 && !knownProductsMap.has(namePart.toLowerCase())) {
            warnings.push(`Product "${namePart}" does not exist in the instance — will be attempted anyway`);
          }
          // Check if already has this access
          if (currentRoleKeys.has(compoundKey)) {
            warnings.push(`User already has access "${r}" — will be skipped`);
          } else {
            changes.push({ type: 'add-role', label: r });
          }
        }

        // Products to remove — validate
        for (const r of row.removeProducts || []) {
          const [namePart, role] = r.includes('|') ? r.split('|', 2) : [r, ''];
          const compoundKey = `${namePart.toLowerCase()}|${(role || '').toLowerCase()}`;
          if (currentRoleKeys.size > 0 && !currentRoleKeys.has(compoundKey)) {
            warnings.push(`User does not have access "${r}" — removal will be skipped`);
          }
          // Only show remove-role if not already shown from current roles parsing above
          if (currentRoleKeys.size === 0) {
            changes.push({ type: 'remove-role', label: r });
          }
        }

        items.push({
          rowIndex: row.rowIndex,
          userIdentifier: userId,
          displayName,
          fullName: row.resolvedUser?.displayName,
          username: row.resolvedUser?.username || row.userName || '',
          email: row.email,
          lastLogin: row.resolvedUser?.lastLogin,
          lastUpdated: row.resolvedUser?.lastUpdated,
          changes,
          warnings: warnings.length > 0 ? warnings : undefined,
        });
      }
    }

    return { items, skipped };
  };

  const handleReview = () => {
    const { items, skipped } = generateSummary();
    if (items.length === 0 && skipped.length === 0) {
      alert('No product access changes to apply. Please add or remove roles.');
      return;
    }
    const hasChanges = items.some((s) =>
      s.changes.some((c) => c.type === 'add-role' || c.type === 'remove-role')
    );
    if (!hasChanges && skipped.length === 0) {
      alert('No product access changes to apply. Please add or remove roles.');
      return;
    }
    setSummary(items, skipped);
    setExecutionPhase('reviewing');
  };

  if (executionPhase !== 'config') return null;

  return (
    <div className="space-y-4">
      {mode === 'single' && selectedUser && (
        <>
          {/* Current roles — grouped by product, each role individually removable */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Current Product Access ({currentRoleEntries.length} role{currentRoleEntries.length !== 1 ? 's' : ''})
              <span className="text-xs text-gray-400 ml-1">— click individual roles to mark for removal</span>
            </h4>
            {Object.keys(currentRolesByProduct).length === 0 ? (
              <span className="text-sm text-gray-400 italic">No product access assigned</span>
            ) : (
              <div className="space-y-2">
                {Object.entries(currentRolesByProduct).map(([productLabel, entries]) => (
                  <div key={productLabel} className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-gray-500 mr-1">{productLabel}:</span>
                    {entries.map((entry) => {
                      // Use the raw string (with [key|role] suffix) from selectedUser.applicationRoles
                      const rawStr = (selectedUser.applicationRoles || []).find(r => {
                        const p = parseRoleString(r);
                        return p.productKey === entry.productKey && p.role === entry.role;
                      }) || '';
                      const isMarkedForRemoval = rolesToRemove.includes(rawStr);
                      return (
                        <button
                          key={`${entry.productKey}|${entry.role}`}
                          onClick={() => rawStr && toggleRemoveRole(rawStr)}
                          className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors border ${
                            isMarkedForRemoval
                              ? 'bg-danger-100 border-danger-300 text-danger-700 line-through'
                              : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                          }`}
                        >
                          {isMarkedForRemoval && <span className="mr-1">&#x2715;</span>}
                          {entry.roleLabel || 'Access'}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Roles to add */}
          {addEntries.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-success-700 mb-2">Roles to Grant</h4>
              <div className="flex flex-wrap gap-2">
                {addEntries.map((entry) => (
                  <span
                    key={entry.compound}
                    className="px-3 py-1 rounded-full text-sm font-medium bg-success-100 border border-success-300 text-success-700 flex items-center gap-1"
                  >
                    + {entry.display}
                    <button
                      onClick={() => setRolesToAdd(rolesToAdd.filter((x) => x !== entry.compound))}
                      className="ml-1 hover:text-success-900"
                    >
                      &#x2715;
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Add product button & popup */}
          <div className="relative">
            <button
              onClick={() => {
                setShowAddPopup(!showAddPopup);
                setSelectedProduct(null);
                setProductSearch('');
                setCheckedRoles(new Set());
              }}
              className="btn-secondary"
            >
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Grant Product Access
            </button>

            {showAddPopup && (
              <div className="absolute z-50 mt-2 bg-white border border-gray-300 rounded-lg shadow-lg flex" style={{ minWidth: '520px' }}>
                {/* Left panel: Product list */}
                <div className="flex-1 border-r border-gray-200" style={{ minWidth: '260px', maxWidth: '300px' }}>
                  <div className="p-3 border-b border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <h5 className="text-sm font-medium text-gray-700">Select Product</h5>
                      <button
                        onClick={() => {
                          setShowAddPopup(false);
                          setSelectedProduct(null);
                          setProductSearch('');
                          setCheckedRoles(new Set());
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <input
                      type="text"
                      className="input-field text-sm"
                      placeholder="Search products..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="max-h-64 overflow-auto">
                    {filteredProducts.map((product) => {
                      const compositeId = product.workspaceId ? `${product.key}:${product.workspaceId}` : product.key;
                      const isSelected = selectedProduct?.key === product.key && selectedProduct?.workspaceId === product.workspaceId;
                      // Count how many roles are unassigned
                      const existingRolesSet = new Set(
                        currentRoleEntries.map(e => `${e.productKey}|${e.role}`)
                      );
                      const addedSet = new Set(rolesToAdd);
                      const unassignedCount = (product.availableRoles || []).filter(role => {
                        const compound = `${product.key}|${role}`;
                        return !existingRolesSet.has(compound) && !addedSet.has(compound);
                      }).length;
                      const userHasProduct = currentRoleEntries.some(e => e.productKey === product.key);

                      return (
                        <button
                          key={compositeId}
                          onClick={() => handleSelectProduct(product)}
                          className={`w-full px-4 py-2.5 text-left flex items-center justify-between border-b border-gray-100 last:border-0 transition-colors ${
                            isSelected ? 'bg-primary-50 border-l-2 border-l-primary-500' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {product.name}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {unassignedCount} role{unassignedCount !== 1 ? 's' : ''} available
                              {userHasProduct && (
                                <span className="text-indigo-500 ml-1">(already has access)</span>
                              )}
                            </div>
                          </div>
                          <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </button>
                      );
                    })}

                    {filteredProducts.length === 0 && (
                      <div className="px-4 py-3 text-sm text-gray-500 italic">
                        {productSearch ? 'No matching products' : 'No additional roles available'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right panel: Role selection with checkboxes */}
                {selectedProduct && (
                  <div style={{ minWidth: '240px' }}>
                    <div className="p-3 border-b border-gray-200">
                      <h5 className="text-sm font-medium text-gray-700">
                        Roles for{' '}
                        <span className="text-primary-700">{selectedProduct.name}</span>
                      </h5>
                    </div>

                    <div className="max-h-52 overflow-auto p-2">
                      {availableRolesForSelected.map((role) => {
                        const isChecked = checkedRoles.has(role);
                        return (
                          <label
                            key={role}
                            className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                              isChecked ? 'bg-primary-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleRoleCheck(role)}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            <div>
                              <div className="text-sm font-medium text-gray-900">{formatRoleLabel(role)}</div>
                              <div className="text-xs text-gray-400 font-mono">{role}</div>
                            </div>
                          </label>
                        );
                      })}
                      {availableRolesForSelected.length === 0 && (
                        <div className="px-3 py-2 text-sm text-gray-500 italic">
                          All roles already assigned or queued
                        </div>
                      )}
                    </div>

                    {availableRolesForSelected.length > 0 && (
                      <div className="p-3 border-t border-gray-200">
                        <button
                          onClick={handleConfirmRoles}
                          disabled={checkedRoles.size === 0}
                          className="btn-primary w-full text-sm"
                        >
                          Add {checkedRoles.size} Role{checkedRoles.size !== 1 ? 's' : ''}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {mode === 'bulk' && (
        <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-700">
            Will process product access changes for{' '}
            <span className="font-semibold">
              {bulkData.filter((r) => !skippedRows.has(r.rowIndex) && ((r.addProducts && r.addProducts.length > 0) || (r.removeProducts && r.removeProducts.length > 0))).length}
            </span>{' '}
            users from the uploaded file based on AddProduct/RemoveProduct columns.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Tip: Use the format <code className="bg-gray-200 px-1 rounded">ProductName|role</code> in your file to specify roles
            (e.g. <code className="bg-gray-200 px-1 rounded">Jira|product/admin</code>). Without a role, the default member role is used.
          </p>
        </div>
      )}

      <button onClick={handleReview} className="btn-primary">
        Review Changes
      </button>
    </div>
  );
}
