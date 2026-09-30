// A Chrome-style dark browser chrome (tab strip + toolbar) shared by the demo
// video tour and the v2/v3 use-case slides, so every live frame has the same
// top bar. The address bar and tab title follow the app's current page.
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, RotateCw, Lock, Plus, X } from "lucide-react";
import { WrapboxLogo } from "../ui/logo";

export function BrowserChrome({ page, live = true, right }: { page: string; live?: boolean; right?: ReactNode }) {
  const slug = page.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="vt-chrome">
      <div className="vt-tabstrip">
        <span className="vt-lights"><i /><i /><i /></span>
        <div className="vt-tab active">
          <span className="vt-fav"><WrapboxLogo size={14} tone="dark" /></span>
          <span className="vt-tab-title">Wrapbox — {page}</span>
          <X size={12} className="vt-tab-x" />
        </div>
        <button className="vt-newtab" aria-label="New tab"><Plus size={14} /></button>
      </div>
      <div className="vt-toolbar">
        <div className="vt-nav">
          <span className="vt-nav-b"><ChevronLeft size={17} /></span>
          <span className="vt-nav-b"><ChevronRight size={17} /></span>
          <span className="vt-nav-b"><RotateCw size={15} /></span>
        </div>
        <div className="vt-addr">
          <Lock size={12} className="vt-addr-lock" />
          <span className="vt-addr-host">wrapbox.io</span>
          <span className="vt-addr-path">/{slug}</span>
          {live && <span className="vt-addr-live"><i /> LIVE</span>}
        </div>
        <div className="vt-toolbar-right">{right}</div>
      </div>
    </div>
  );
}
