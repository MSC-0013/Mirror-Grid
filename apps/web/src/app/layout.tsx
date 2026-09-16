import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

export const metadata: Metadata = {
  title: 'MIRRORGRID — Distributed Systems Reliability Laboratory',
  description: 'Model topologies, generate workloads, and inject deterministic chaos.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-container">
          <Sidebar />
          <div className="main-content">
            <Topbar />
            <main className="content-area">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
