#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R11.md"
echo "# R11 · 打包体积" > $F
echo "## dist 产物大小" >> $F
echo '```' >> $F
du -sh $ROOT/web/dist 2>/dev/null >> $F
find $ROOT/web/dist -name '*.js' -exec ls -lh {} \; 2>/dev/null | awk '{print $5, $9}' | sort -rh | head -20 >> $F
echo '```' >> $F
echo "## 单文件超大源码 (>500 行, 建议拆分)" >> $F
find $WEB -name '*.jsx' -exec wc -l {} \; 2>/dev/null | awk '$1>500' | sort -rn | sed "s#$WEB/##" >> $F
echo "## 代码分割 (lazy/dynamic import)" >> $F
echo "React.lazy: $(grep -rc 'lazy(' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}'), 动态 import(): $(grep -rc 'import(' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 大依赖 (node_modules top)" >> $F
echo '```' >> $F
du -sh $ROOT/web/node_modules/* 2>/dev/null | sort -rh | head -15 >> $F
echo '```' >> $F
echo "## vite manualChunks 配置?" >> $F
grep -A5 'manualChunks\|rollupOptions' $ROOT/web/vite.config.js 2>/dev/null | head -20 >> $F
echo "## 建议: 路由/大组件 React.lazy；manualChunks 拆 vendor；tree-shake 大库" >> $F
echo "DONE R11"
