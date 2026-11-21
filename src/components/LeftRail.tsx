import React from 'react';
import { LogOut, MessageSquare, Settings, UserPlus, Users } from 'lucide-react';
import type { RailSection } from '../types';

interface LeftRailProps {
  activeSection: RailSection;
  onSelectSection: (section: RailSection) => void;
  pendingCount: number;
  onSignOut: () => void;
}

export const LeftRail: React.FC<LeftRailProps> = ({
  activeSection,
  onSelectSection,
  pendingCount,
  onSignOut,
}) => {
  return (
    <nav className="left-rail" aria-label="Primary navigation">
      <div className="rail-group">
        <div className="rail-logo" title="veil">
          v.
        </div>

        <button
          type="button"
          className={`rail-btn ${activeSection === 'dms' ? 'active' : ''}`}
          onClick={() => onSelectSection('dms')}
          title="Direct Messages"
          aria-label="Direct Messages"
        >
          <MessageSquare size={18} strokeWidth={1.75} />
        </button>

        <button
          type="button"
          className={`rail-btn ${activeSection === 'groups' ? 'active' : ''}`}
          onClick={() => onSelectSection('groups')}
          title="Group Chats"
          aria-label="Group Chats"
        >
          <Users size={18} strokeWidth={1.75} />
        </button>

        <button
          type="button"
          className={`rail-btn ${activeSection === 'friends' ? 'active' : ''}`}
          onClick={() => onSelectSection('friends')}
          title="Friends"
          aria-label="Friends"
        >
          <UserPlus size={18} strokeWidth={1.75} />
          {pendingCount > 0 && <span className="rail-badge">{pendingCount}</span>}
        </button>
      </div>

      <div className="rail-group">
        <button
          type="button"
          className={`rail-btn ${activeSection === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectSection('settings')}
          title="Profile & Settings"
          aria-label="Profile & Settings"
        >
          <Settings size={18} strokeWidth={1.75} />
        </button>

        <button
          type="button"
          className="rail-btn"
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut size={17} strokeWidth={1.75} />
        </button>
      </div>
    </nav>
  );
};
