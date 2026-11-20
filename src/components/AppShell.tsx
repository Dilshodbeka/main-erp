import type { ReactNode } from 'react';
import { ChevronRight, LogOut, Menu, RefreshCw } from 'lucide-react';
import { usePullToRefresh } from '../pull-refresh';

export interface AppShellProps {
  menu: boolean;
  setMenu: (open: boolean) => void;
  pageKey: string;
  title: string;
  sidebar: ReactNode;
  searchBox: ReactNode;
  onRefresh: () => void;
  busy: boolean;
  liveLabel: ReactNode;
  onLive: () => void;
  onSignOut: () => void;
  banners: ReactNode;
  footer: ReactNode;
  mobileNav: ReactNode;
  overlays?: ReactNode;
  children: ReactNode;
}

export function AppShell(props: AppShellProps) {
  const pullIndicator = usePullToRefresh(props.onRefresh, props.busy);
  return (
    <div className="app-shell">
      <div ref={pullIndicator} className="ptr" aria-hidden="true"><RefreshCw size={18} /></div>
      <aside className={`sidebar ${props.menu ? 'open' : ''}`}>{props.sidebar}</aside>
      {props.menu && <button className="menu-shade" aria-label="Menyuni yopish" onClick={() => props.setMenu(false)} />}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button className="icon-button mobile-only" aria-label="Menyuni ochish" onClick={() => props.setMenu(true)}><Menu size={21} /></button>
            <span>Korxona</span><ChevronRight size={14} /><b>{props.title}</b>
          </div>
          <div className="topbar-actions">
            {props.searchBox}
            <button className="icon-button" aria-label="Ma’lumotlarni yangilash" onClick={props.onRefresh} disabled={props.busy}><RefreshCw size={17} /></button>
            <button className="live-indicator" onClick={props.onLive}><i />{props.liveLabel}</button>
            <button className="session-exit" onClick={props.onSignOut} title="Chiqish"><LogOut size={16} />Chiqish</button>
          </div>
        </header>
        {props.banners}
        <main className="page-main" key={props.pageKey}>{props.children}</main>
        {props.footer}
      </div>
      {props.mobileNav}
      {props.overlays}
    </div>
  );
}
