import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

export function Shell() {
  const onDeliveries = useLocation().pathname === '/deliveries';
  return (
    <div className={onDeliveries ? 'shell shell-deliveries' : 'shell'}>
      <div className="shell-main">
        <Outlet />
      </div>
      <nav className="shell-nav" aria-label="Customer">
        <TabLink to="/home" label="Home" end>
          {(active) => <HomeIcon filled={active} />}
        </TabLink>
        <TabLink to="/deliveries" label="Deliveries" end>
          {(active) => <PackageIcon filled={active} />}
        </TabLink>
        <TabLink to="/profile" label="Profile" end>
          {(active) => <AccountIcon filled={active} />}
        </TabLink>
      </nav>
    </div>
  );
}

function TabLink({
  to,
  label,
  end = false,
  children,
}: {
  to: string;
  label: string;
  end?: boolean;
  children: (active: boolean) => ReactNode;
}) {
  return (
    <NavLink to={to} end={end} className="shell-tab">
      {({ isActive }) => (
        <>
          <span className="shell-tab-icon">{children(isActive)}</span>
          {label}
        </>
      )}
    </NavLink>
  );
}

function HomeIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {filled ? (
        <path d="M12 3.2 3 11h2v9h5.2v-5.4h3.6V20H19v-9h2L12 3.2Z" />
      ) : (
        <path d="M12 5.69 17 10.19V18h-2v-6H9v6H7v-7.81L12 5.69M12 3 2 12h3v8h6v-6h2v6h6v-8h3L12 3Z" />
      )}
    </svg>
  );
}

function PackageIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {filled ? (
        <path d="M12 2.2 3.4 7.05v9.9L12 21.8l8.6-4.85v-9.9L12 2.2Z" />
      ) : (
        <path d="M12 3.2 4.2 7.2v9.6L12 20.8l7.8-4V7.2L12 3.2Zm0 1.7 5.8 3-5.8 3-5.8-3 5.8-3ZM5.7 9.4l5.3 2.7v6.2l-5.3-2.7V9.4Zm7.3 8.9v-6.2l5.3-2.7v6.2l-5.3 2.7Z" />
      )}
    </svg>
  );
}

function AccountIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {filled ? (
        <path d="M12 12.2a4.1 4.1 0 1 0-4.1-4.1 4.1 4.1 0 0 0 4.1 4.1Zm0 2.1c-3.4 0-7.2 1.7-7.2 4.2v1.3h14.4v-1.3c0-2.5-3.8-4.2-7.2-4.2Z" />
      ) : (
        <path d="M12 12.4a3.6 3.6 0 1 0-3.6-3.6 3.6 3.6 0 0 0 3.6 3.6Zm0-8.7a5.1 5.1 0 1 1-5.1 5.1A5.1 5.1 0 0 1 12 3.7ZM5.2 20.2v-.6c0-2.2 3-3.8 6.8-3.8s6.8 1.6 6.8 3.8v.6H5.2Zm1.6-1.5h10.4c-.4-1-2.4-2.1-5.2-2.1s-4.8 1.1-5.2 2.1Z" />
      )}
    </svg>
  );
}
