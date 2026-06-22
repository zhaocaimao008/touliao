/**
 * 纯 CSS 模拟的手机聊天界面（占位）。
 * 待有真实 App 截图后，可整体替换为 <img>。
 */
export function PhoneMock() {
  const messages = [
    { me: false, text: '周末一起爬山？🏔️' },
    { me: true, text: '好啊，约几点' },
    { me: false, text: '八点山脚见，路线我发你' },
    { me: true, text: '收到，已加入收藏 ⭐' },
  ];
  return (
    <div className="relative mx-auto w-[280px] animate-float">
      {/* 光晕 */}
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-brand-200/40 blur-3xl" />
      <div className="rounded-[2.5rem] border-[10px] border-ink-900 bg-ink-900 shadow-2xl">
        <div className="overflow-hidden rounded-[1.7rem] bg-ink-50">
          {/* 顶栏 */}
          <div className="flex items-center justify-between bg-brand-600 px-4 py-3 text-white">
            <span className="text-sm">‹</span>
            <span className="text-sm font-semibold">登山小队</span>
            <span className="flex items-center gap-1 text-[10px] opacity-90">
              🔒 加密
            </span>
          </div>
          {/* 消息流 */}
          <div className="flex h-[360px] flex-col gap-3 p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.me ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-[13px] shadow-sm ${
                    m.me
                      ? 'rounded-br-sm bg-brand-600 text-white'
                      : 'rounded-bl-sm bg-white text-ink-900'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            <div className="mt-auto flex items-center gap-2 rounded-full bg-white px-3 py-2 text-[12px] text-ink-400 shadow-sm">
              <span className="flex-1">输入消息…</span>
              <span className="text-brand-600">发送</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
