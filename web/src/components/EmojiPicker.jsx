import React, { useState } from 'react';
import { useI18n } from '../contexts/I18nContext';

// id 是稳定标识（用于 localStorage 持久化 / 相等比较 / React key），跨语言切换不变；
// 展示名走 nameKey 经 t() 取词，与 id 解耦，避免切换语言后"上次选中分类"失配。
const CATEGORIES = [
  { id: 'frequent', label: '😊', nameKey: 'emoji.catFrequent', emojis: ['😊','😂','🤣','❤️','😍','🙏','😭','😘','👍','😅','👏','🔥','🥰','😁','💕','🎉','💪','🤔','😉','👌','🥺','😢','😎','💯','🙌','🤗','😋','😝','🤩','😆','💖','🤞','😤','😡','😱','🥳','😴','🤭','🤫','🥴'] },
  { id: 'smileys', label: '😀', nameKey: 'emoji.catSmileys', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😠','😡','🤬','😈','👿','💀','☠️'] },
  { id: 'gestures', label: '👋', nameKey: 'emoji.catGestures', emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁','👅','👄'] },
  { id: 'hearts', label: '❤️', nameKey: 'emoji.catHearts', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎','☯️','🆚','💢','💥','💫','💦','💨','🕳️','💬','💭','💤'] },
  { id: 'objects', label: '🎁', nameKey: 'emoji.catObjects', emojis: ['🎁','🎀','🎊','🎉','🎈','🎂','🍰','🧁','🍭','🍬','🍫','🍩','🍪','☕','🍵','🧃','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧋','🍾','🎵','🎶','🎸','🎹','🎷','🎺','🎻','🥁','🎮','🕹️','🎲','🎯','🎳','🏆','🥇','🥈','🥉'] },
  { id: 'nature', label: '🌟', nameKey: 'emoji.catNature', emojis: ['🌟','⭐','🌙','☀️','🌈','⛅','🌤️','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌊','🌀','🌪️','🌫️','🌬️','🌸','🌺','🌻','🌼','💐','🌷','🍀','🍁','🍂','🍃','🌿','☘️','🌱','🌲','🌳','🌴','🌵','🎋','🎍','🌾','🍄','🌰','🦔','🦦','🐾','🦁','🐯','🐻','🐼','🐨','🐸','🐧','🐦','🦅','🦆','🦉','🦚','🦜','🐝','🦋','🐛','🐌','🐞','🐜'] },
];

const RECENT_KEY = 'touliao_emoji_recent';
const MAX_RECENT = 24;
function loadRecent() {
  try { const a = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(a) ? a.slice(0, MAX_RECENT) : []; }
  catch { return []; }
}

// 记住上次选的分类名（跨开合）——持久化到 localStorage，避免任何模块级可变状态，
// 满足 react-hooks 纯度约束（globals/immutability），同时跨挂载保留选择。
const LAST_CAT_KEY = 'touliao_emoji_last_cat';
const getLastCat = () => { try { return localStorage.getItem(LAST_CAT_KEY); } catch { return null; } };
const setLastCat = (name) => { try { localStorage.setItem(LAST_CAT_KEY, name); } catch { /* 存储不可用则忽略 */ } };

export default function EmojiPicker({ onSelect }) {
  const { t } = useI18n();
  const [recent, setRecent] = useState(loadRecent);
  // 有历史时把「最近」分类置顶，个性化高频表情，比静态「常用」更贴合本人使用
  const cats = recent.length
    ? [{ id: 'recent', label: '🕐', nameKey: 'emoji.catRecent', emojis: recent }, ...CATEGORIES]
    : CATEGORIES;
  // 按分类 id 选中（而非索引）：新增「最近」置顶时不会错位当前分类；
  // 旧版本 localStorage 里可能残留中文分类名，匹配不到时下面的 find() 会 fallback 到 cats[0]，自愈。
  const [catId, setCatId] = useState(() => getLastCat() || (recent.length ? 'recent' : 'frequent'));
  const activeCat = cats.find(c => c.id === catId) || cats[0];

  const handleCatChange = (id) => { setLastCat(id); setCatId(id); };

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
      <div className="wc-emoji-cats" role="tablist" aria-label={t('emoji.categoriesAria')}
        onKeyDown={e => {
          // ←/→ 在分类间移动(标准 tablist 键盘模式),循环切换
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          const i = cats.findIndex(c => c.id === activeCat.id);
          const n = cats.length;
          const next = e.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n;
          handleCatChange(cats[next].id);
          // 焦点跟随新激活的分类(roving tabindex):否则读屏不播报、Tab 行为错乱
          const tabs = e.currentTarget.querySelectorAll('.wc-emoji-cat');
          tabs[next]?.focus();
        }}>
        {cats.map((c) => (
          <button key={c.id} className={`wc-emoji-cat${activeCat.id === c.id ? ' active' : ''}`}
            role="tab" aria-selected={activeCat.id === c.id} aria-label={t(c.nameKey)}
            tabIndex={activeCat.id === c.id ? 0 : -1}
            onClick={() => handleCatChange(c.id)} title={t(c.nameKey)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="wc-emoji-grid" role="tabpanel" aria-label={t(activeCat.nameKey)}>
        {activeCat.emojis.map(e => (
          <button key={e} className="wc-emoji-btn" aria-label={e} onClick={() => pick(e)}>{e}</button>
        ))}
      </div>
    </div>
  );
}
