import React, { useState } from 'react';

const CATEGORIES = [
  { label: '😊', name: '常用', emojis: ['😊','😂','🤣','❤️','😍','🙏','😭','😘','👍','😅','👏','🔥','🥰','😁','💕','🎉','💪','🤔','😉','👌','🥺','😢','😎','💯','🙌','🤗','😋','😝','🤩','😆','💖','🤞','😤','😡','😱','🥳','😴','🤭','🤫','🥴'] },
  { label: '😀', name: '表情', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😠','😡','🤬','😈','👿','💀','☠️'] },
  { label: '👋', name: '手势', emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁','👅','👄'] },
  { label: '❤️', name: '爱心', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎','☯️','🆚','💢','💥','💫','💦','💨','🕳️','💬','💭','💤'] },
  { label: '🎁', name: '物品', emojis: ['🎁','🎀','🎊','🎉','🎈','🎂','🍰','🧁','🍭','🍬','🍫','🍩','🍪','☕','🍵','🧃','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧋','🍾','🎵','🎶','🎸','🎹','🎷','🎺','🎻','🥁','🎮','🕹️','🎲','🎯','🎳','🏆','🥇','🥈','🥉'] },
  { label: '🌟', name: '自然', emojis: ['🌟','⭐','🌙','☀️','🌈','⛅','🌤️','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌊','🌀','🌪️','🌫️','🌬️','🌸','🌺','🌻','🌼','💐','🌷','🍀','🍁','🍂','🍃','🌿','☘️','🌱','🌲','🌳','🌴','🌵','🎋','🎍','🌾','🍄','🌰','🦔','🦦','🐾','🦁','🐯','🐻','🐼','🐨','🐸','🐧','🐦','🦅','🦆','🦉','🦚','🦜','🐝','🦋','🐛','🐌','🐞','🐜'] },
];

const RECENT_KEY = 'vxin_emoji_recent';
const MAX_RECENT = 24;
function loadRecent() {
  try { const a = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(a) ? a.slice(0, MAX_RECENT) : []; }
  catch { return []; }
}

let lastCat = null; // 记住上次选的分类名（跨开合），null=未显式选择

export default function EmojiPicker({ onSelect }) {
  const [recent, setRecent] = useState(loadRecent);
  // 有历史时把「最近」分类置顶，个性化高频表情，比静态「常用」更贴合本人使用
  const cats = recent.length
    ? [{ label: '🕐', name: '最近', emojis: recent }, ...CATEGORIES]
    : CATEGORIES;
  // 按分类名选中（而非索引）：新增「最近」置顶时不会错位当前分类
  const [catName, setCatName] = useState(() => lastCat || (recent.length ? '最近' : '常用'));
  const activeCat = cats.find(c => c.name === catName) || cats[0];

  const handleCatChange = (name) => { lastCat = name; setCatName(name); };

  const pick = (e) => {
    setRecent(prev => {
      const next = [e, ...prev.filter(x => x !== e)].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* 存储不可用则忽略 */ }
      return next;
    });
    onSelect(e);
  };

  return (
    <div className="wc-emoji-picker">
      <div className="wc-emoji-cats" role="tablist" aria-label="表情分类"
        onKeyDown={e => {
          // ←/→ 在分类间移动(标准 tablist 键盘模式),循环切换
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          const i = cats.findIndex(c => c.name === activeCat.name);
          const n = cats.length;
          const next = e.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n;
          handleCatChange(cats[next].name);
          // 焦点跟随新激活的分类(roving tabindex):否则读屏不播报、Tab 行为错乱
          const tabs = e.currentTarget.querySelectorAll('.wc-emoji-cat');
          tabs[next]?.focus();
        }}>
        {cats.map((c) => (
          <button key={c.name} className={`wc-emoji-cat${activeCat.name === c.name ? ' active' : ''}`}
            role="tab" aria-selected={activeCat.name === c.name} aria-label={c.name}
            tabIndex={activeCat.name === c.name ? 0 : -1}
            onClick={() => handleCatChange(c.name)} title={c.name}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="wc-emoji-grid" role="tabpanel" aria-label={activeCat.name}>
        {activeCat.emojis.map(e => (
          <button key={e} className="wc-emoji-btn" aria-label={e} onClick={() => pick(e)}>{e}</button>
        ))}
      </div>
    </div>
  );
}
