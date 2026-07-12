#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R20.md"
echo "# R20 · 桌面/移动/文档一致性" > $F
echo "## Electron 安全" >> $F
echo '```' >> $F
grep -rnE 'nodeIntegration|contextIsolation|webSecurity|enableRemoteModule' $DESK 2>/dev/null | head -20 >> $F
echo '```' >> $F
echo "- nodeIntegration:true 风险: $(grep -rc 'nodeIntegration: true\|nodeIntegration:true' $DESK 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "- contextIsolation:false 风险: $(grep -rc 'contextIsolation: false\|contextIsolation:false' $DESK 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "- preload/contextBridge: $(grep -rc 'contextBridge\|preload' $DESK 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## shell.openExternal / 未校验 URL" >> $F
grep -rn 'openExternal\|shell\.' $DESK 2>/dev/null | head -10 >> $F
echo "## Capacitor (移动) 配置" >> $F
cat $ROOT/web/capacitor.config.json 2>/dev/null | head -20 >> $F
echo "## 平台文档" >> $F
ls $ROOT/web/MULTIPLATFORM.md $DESK/../SECURITY-RELEASE.md 2>/dev/null >> $F
echo "## 建议: 关闭 nodeIntegration/开启 contextIsolation+preload；openExternal 校验协议；统一三端版本号" >> $F
echo "DONE R20"
