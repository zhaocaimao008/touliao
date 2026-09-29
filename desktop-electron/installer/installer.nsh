; electron-builder 自定义 NSIS 片段（package.json build.nsis.include 引用）。
;
; 升级安装时 electron-builder 会保留用户已有的桌面/开始菜单快捷方式，而 Windows
; 图标缓存按 exe 路径缓存图标——exe 里的图标资源换了，快捷方式/任务栏固定项仍显示
; 旧图标，直到缓存过期或重启资源管理器。安装结束时广播 SHCNE_ASSOCCHANGED，让
; 资源管理器丢弃图标缓存并重绘，换品牌图标后升级用户能立即看到新图标。
!macro customInstall
  ; SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
