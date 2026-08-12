#!/bin/bash
set -e

TIMESTAMP=$(date +%s)
VERSION="v${TIMESTAMP}"

echo "════════════════════════════════════════════════════════════"
echo "🔵 灰度部署 5% - Canary 5% Deployment"
echo "════════════════════════════════════════════════════════════"
echo "版本: $VERSION"
echo "目标: 灰度环境 (Region A) - 5% 流量"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Step 1: 构建容器镜像
echo "🔨 构建容器镜像..."
docker build -t vxin-backend:$VERSION \
  --build-arg NODE_ENV=production \
  --build-arg VERSION=$VERSION \
  -f Dockerfile .

echo "✅ 镜像构建完成: vxin-backend:$VERSION"

# Step 2: 推送到仓库
echo "📤 推送镜像到仓库..."
docker tag vxin-backend:$VERSION registry.vxin.com/backend:$VERSION
docker push registry.vxin.com/backend:$VERSION

# Step 3: 部署灰度环境 (5%)
echo "🚀 部署灰度环境 (5% 流量)..."
cat > /tmp/canary-5percent-deployment.yaml << 'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vxin-backend-canary-5
  namespace: production
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vxin-backend
      track: canary
      weight: "5"
  template:
    metadata:
      labels:
        app: vxin-backend
        track: canary
        weight: "5"
    spec:
      containers:
      - name: backend
        image: registry.vxin.com/backend:VERSION
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        - name: CANARY_WEIGHT
          value: "5"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
YAML

sed "s/VERSION/$VERSION/g" /tmp/canary-5percent-deployment.yaml | kubectl apply -f -

# Step 4: 配置流量权重 (Istio VirtualService)
echo "🔀 配置灰度流量权重 (5%)..."
cat > /tmp/canary-virtualservice.yaml << 'YAML'
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: vxin-backend
  namespace: production
spec:
  hosts:
  - vxin-backend.service.vxin.com
  http:
  - match:
    - sourceLabels:
        track: canary
    route:
    - destination:
        host: vxin-backend
        port:
          number: 3000
      weight: 5
    - destination:
        host: vxin-backend-stable
        port:
          number: 3000
      weight: 95
YAML

kubectl apply -f /tmp/canary-virtualservice.yaml

# Step 5: 等待容器就绪
echo "⏳ 等待容器就绪..."
kubectl rollout status deployment/vxin-backend-canary-5 -n production --timeout=5m

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✅ 灰度 5% 部署完成！"
echo "   版本: $VERSION"
echo "   流量: 5%"
echo "   监控: kubectl logs -f deployment/vxin-backend-canary-5"
echo "════════════════════════════════════════════════════════════"

# 记录部署时间戳
echo "$VERSION" > /tmp/canary-5-version.txt
