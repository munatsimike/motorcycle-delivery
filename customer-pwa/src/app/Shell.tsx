import { NavLink, Outlet } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';

export function Shell() {
  return (
    <div className="shell">
      <header className="shell-header">
        <NavLink to="/" aria-label="Riders welcome">
          <BrandLogo />
        </NavLink>
      </header>
      <div className="shell-main">
        <Outlet />
      </div>
      <nav className="shell-nav" aria-label="Customer">
        <NavLink to="/book" end>
          Book
        </NavLink>
        <NavLink to="/deliveries">
          Deliveries
        </NavLink>
        <NavLink to="/profile" end>
          Profile
        </NavLink>
      </nav>
    </div>
  );
}
