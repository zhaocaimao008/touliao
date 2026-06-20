#!/bin/bash
# 在服务器上运行此脚本来安装公钥

PUBLIC_KEY_CONTENT='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJKNcQKmUmBBI8cHVb7FQDC//ILd/3dRnHTgo7+QVqgs vxin-backend-deploy-1781151288'

if grep -q "$PUBLIC_KEY_CONTENT" ~/.ssh/authorized_keys 2>/dev/null; then
    echo "✅ 公钥已存在"
else
    echo "Adding public key..."
    echo "$PUBLIC_KEY_CONTENT" >> ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
    echo "✅ 公钥已添加"
fi

