import React from 'react';
import './ResponsiveHomeLayout.css';

/** Keep the panel and conversation at stable React positions across width changes. */
export default function ResponsiveHomeLayout({
  mobile, fullPanel, widePanel, chatOpen, showChatArea,
  sidebar, navigation, header, guides, children, chat, overlays,
}) {
  return <div className={`home-responsive-shell ${mobile ? 'm-shell' : `wc-app${fullPanel ? ' tl-full-panel' : ''}`}`}>
    {!mobile && <div key="sidebar" className="wc-sidebar">{sidebar}</div>}
    <div key="workspace" className={mobile ? 'home-mobile-workspace' : 'wc-main'}>
      <div key="panel" className={mobile ? 'm-page' : `wc-panel${widePanel ? ' wc-panel-wide' : ''}`}
        hidden={mobile && chatOpen}>
        <React.Fragment key="header">{header}</React.Fragment>
        <React.Fragment key="guides">{guides}</React.Fragment>
        <div key="content" className={mobile ? 'm-content' : 'wc-panel-content'}>{children}</div>
      </div>
      <div key="chat" className={mobile ? 'm-chat-page' : 'home-chat-area'}
        hidden={!showChatArea || (mobile && !chatOpen)}>{chat}</div>
    </div>
    {mobile && !chatOpen && <React.Fragment key="navigation">{navigation}</React.Fragment>}
    {overlays}
  </div>;
}
