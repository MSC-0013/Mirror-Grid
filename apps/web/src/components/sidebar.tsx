'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Globe, Zap, Shield, RotateCcw, Server } from 'lucide-react';

export function Sidebar() {
  const pathname = usePathname();

  const links = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Worlds', href: '/worlds', icon: Globe },
    { name: 'Fleet', href: '/fleet', icon: Server },
    { name: 'Faults', href: '/faults', icon: Zap },
    { name: 'Breakers', href: '/breakers', icon: Shield },
    { name: 'Replay', href: '/replay', icon: RotateCcw },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div style={{ width: 24, height: 24, backgroundColor: 'var(--color-primary)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13 }}>
          MG
        </div>
        MIRRORGRID
      </div>
      <ul className="nav-links">
        {links.map(link => {
          const Icon = link.icon;
          const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
          return (
            <li key={link.href}>
              <Link href={link.href} className={`nav-link ${isActive ? 'active' : ''}`}>
                <Icon size={18} />
                <span>{link.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div style={{ padding: 16, borderTop: '1px solid var(--color-border)', fontSize: 12, color: 'var(--color-text-secondary)' }}>
        v0.1.0 • Core Tier
      </div>
    </aside>
  );
}
