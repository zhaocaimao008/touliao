# P8: 多区域全球部署 - Terraform 配置

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# 区域 1: 国内 (阿里云)
provider "alicloud" {
  region = "cn-hangzhou"
}

# 区域 2: 欧洲 (AWS EU-West-1)
provider "aws" {
  alias  = "eu"
  region = "eu-west-1"
}

# 区域 3: 北美 (AWS US-East-1)
provider "aws" {
  alias  = "us"
  region = "us-east-1"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 区域 1: 国内部署 (阿里云)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

resource "alicloud_instance" "vxin_cn" {
  instance_type              = "ecs.t6.large"
  image_id                   = "ubuntu_22_x64"
  availability_zone          = "cn-hangzhou-b"
  instance_name              = "vxin-cn-primary"
  internet_charge_type       = "PayByTraffic"
  security_groups            = ["${alicloud_security_group.vxin_cn.id}"]
  vswitch_id                 = "vsw-xxxxx"
  private_ip                 = "172.31.0.10"
}

resource "alicloud_rds_instance" "vxin_db_cn" {
  engine         = "PostgreSQL"
  engine_version = "14.0"
  instance_type  = "pg.xlarge"
  storage        = 100
  instance_name  = "vxin-db-cn"
  security_ips   = ["${alicloud_instance.vxin_cn.private_ip}"]
}

resource "alicloud_kvstore_instance" "vxin_redis_cn" {
  instance_class = "redis.master.large"
  instance_name  = "vxin-redis-cn"
  zone_id        = "cn-hangzhou-b"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 区域 2: 欧洲部署 (AWS EU-West-1)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

resource "aws_instance" "vxin_eu" {
  provider                = aws.eu
  ami                     = "ami-0c55b159cbfafe1f0"
  instance_type           = "t3.large"
  key_name                = aws_key_pair.vxin_eu.key_name
  vpc_security_group_ids  = [aws_security_group.vxin_eu.id]
  subnet_id               = aws_subnet.vxin_eu.id
  associate_public_ip_address = true

  tags = {
    Name = "vxin-eu-primary"
  }
}

resource "aws_db_instance" "vxin_db_eu" {
  provider             = aws.eu
  identifier           = "vxin-db-eu"
  engine               = "postgres"
  engine_version       = "14.7"
  instance_class       = "db.t3.large"
  allocated_storage    = 100
  storage_type         = "gp3"
  username             = "postgres"
  password             = random_password.db_password_eu.result
  db_subnet_group_name = aws_db_subnet_group.vxin_eu.name
  multi_az             = true
  publicly_accessible  = false
}

resource "aws_elasticache_cluster" "vxin_redis_eu" {
  provider            = aws.eu
  cluster_id          = "vxin-redis-eu"
  engine              = "redis"
  node_type           = "cache.t3.medium"
  num_cache_nodes     = 3
  parameter_group_name = "default.redis7"
  engine_version      = "7.0"
  port                = 6379
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 区域 3: 北美部署 (AWS US-East-1)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

resource "aws_instance" "vxin_us" {
  provider                = aws.us
  ami                     = "ami-0c55b159cbfafe1f0"
  instance_type           = "t3.large"
  key_name                = aws_key_pair.vxin_us.key_name
  vpc_security_group_ids  = [aws_security_group.vxin_us.id]
  subnet_id               = aws_subnet.vxin_us.id

  tags = {
    Name = "vxin-us-primary"
  }
}

resource "aws_db_instance" "vxin_db_us" {
  provider             = aws.us
  identifier           = "vxin-db-us"
  engine               = "postgres"
  engine_version       = "14.7"
  instance_class       = "db.t3.large"
  allocated_storage    = 100
  multi_az             = true
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 全局 CDN 与负载均衡
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

resource "aws_cloudfront_distribution" "vxin_cdn" {
  enabled = true

  origin {
    domain_name = "cn.vxin.com"
    origin_id   = "vxin-cn"
  }

  origin {
    domain_name = "eu.vxin.com"
    origin_id   = "vxin-eu"
  }

  origin {
    domain_name = "us.vxin.com"
    origin_id   = "vxin-us"
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "vxin-cn"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "https-only"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 跨域同步配置
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

resource "aws_dms_replication_instance" "vxin_sync" {
  replication_instance_id   = "vxin-dms"
  replication_instance_class = "dms.t3.large"
  allocated_storage         = 100
}

resource "aws_dms_replication_task" "cn_to_eu" {
  replication_instance_arn  = aws_dms_replication_instance.vxin_sync.arn
  migration_type            = "cdc" # Change Data Capture
  source_endpoint_arn       = aws_dms_endpoint.cn.arn
  target_endpoint_arn       = aws_dms_endpoint.eu.arn
  table_mappings            = jsonencode({
    rules = [{
      rule-type = "selection"
      rule-id   = "1"
      rule-name = "sync-all-tables"
      object-locator = {
        schema-name = "%"
        table-name  = "%"
      }
      rule-action = "include"
    }]
  })
}

# 输出全局端点
output "cdn_domain" {
  value = aws_cloudfront_distribution.vxin_cdn.domain_name
}

output "regions" {
  value = {
    china   = alicloud_instance.vxin_cn.public_ip
    europe  = aws_instance.vxin_eu.public_ip
    america = aws_instance.vxin_us.public_ip
  }
}
