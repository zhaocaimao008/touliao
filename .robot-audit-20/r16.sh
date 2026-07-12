#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R16.md"
echo "# R16 · 实时/Socket" > $F
echo "## socket 相关文件" >> $F
grep -rln -iE 'socket\.io|new WebSocket|io\(' $BE --include=*.js 2>/dev/null | sed "s#$BE/##" >> $F
echo "## socket 事件 handler 数" >> $F
echo "socket.on: $(grep -rc 'socket.on\|\.on(' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 事件入参校验" >> $F
echo "socket handler 中 validate: $(grep -rc -iE 'validate|schema' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 断线/重连处理" >> $F
echo "disconnect: $(grep -rc 'disconnect' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}'), reconnect(前端): $(grep -rc -i reconnect $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## socket 鉴权 (握手 auth)" >> $F
echo '```' >> $F
grep -rnE 'io.use|handshake|socket.handshake|auth' $BE --include=*.js 2>/dev/null | grep -i socket | head -15 >> $F
echo '```' >> $F
echo "## 前端 ReconnectingBanner 存在: $([ -f $WEB/components/ReconnectingBanner.jsx ] && echo yes)" >> $F
echo "## 建议: socket 握手鉴权；事件入参 schema 校验；房间权限校验；心跳/重连退避" >> $F
echo "DONE R16"
