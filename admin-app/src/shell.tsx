import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';

const LINKS = [
  ['/', 'Overview'],
  ['/riders', 'Riders'],
  ['/motorcycles', 'Motorcycles'],
  ['/deliveries', 'Deliveries'],
  ['/settings', 'Settings'],
] as const;

export function Shell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function logout() {
    const result = await auth.logout();
    navigate('/sign-in', {
      replace: true,
      state: result.serverRevoked ? null : { notice: 'This browser was signed out. The server may still have this session.' },
    });
  }

  return (
    <div className="shell">
      <a className="skip" href="#content">Skip to content</a>
      {open ? <button className="scrim" type="button" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <aside className={open ? 'sidebar open' : 'sidebar'}>
        <div className="brand"><strong>Riders</strong><span>Admin</span></div>
        <nav aria-label="Administration">
          {LINKS.map(([to, name]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>{name}</NavLink>
          ))}
        </nav>
        <footer>
          <button className="button-secondary" type="button" onClick={() => void logout()}>Log out</button>
        </footer>
      </aside>
      <div className="workspace">
        <button className="menu-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Menu</button>
        <main id="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
