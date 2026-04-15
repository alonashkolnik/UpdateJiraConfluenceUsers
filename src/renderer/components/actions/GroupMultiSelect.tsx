import React, { useState, useRef, useEffect } from 'react';

interface GroupMultiSelectProps {
  groups: string[];
  selected: string[];
  onSelect: (groups: string[]) => void;
  onClose: () => void;
}

export function GroupMultiSelect({ groups, selected, onSelect, onClose }: GroupMultiSelectProps) {
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set(selected));
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const filtered = search
    ? groups.filter((g) => g.toLowerCase().includes(search.toLowerCase()))
    : groups;

  const toggleGroup = (group: string) => {
    const next = new Set(localSelected);
    if (next.has(group)) {
      next.delete(group);
    } else {
      next.add(group);
    }
    setLocalSelected(next);
  };

  const handleApply = () => {
    onSelect(Array.from(localSelected));
  };

  return (
    <div
      ref={ref}
      className="absolute z-50 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg"
    >
      {/* Search */}
      <div className="p-2 border-b border-gray-100">
        <input
          type="text"
          className="input-field text-sm"
          placeholder="Search groups..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {/* Group list */}
      <div className="max-h-52 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gray-400">No groups found</div>
        ) : (
          filtered.map((group) => (
            <label
              key={group}
              className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={localSelected.has(group)}
                onChange={() => toggleGroup(group)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">{group}</span>
            </label>
          ))
        )}
      </div>

      {/* Actions */}
      <div className="p-2 border-t border-gray-100 flex justify-between items-center">
        <span className="text-xs text-gray-400">{localSelected.size} selected</span>
        <div className="flex gap-2">
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <button onClick={handleApply} className="btn-primary text-xs py-1 px-3">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
