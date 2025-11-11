terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket = "education-platform-terraform-state"
    key    = "aws/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# VPC
module "vpc" {
  source = "./modules/vpc"
  
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  environment          = var.environment
}

# EKS Cluster
module "eks" {
  source = "./modules/eks"
  
  cluster_name    = var.cluster_name
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnet_ids
  node_group_size = var.eks_node_group_size
  
  depends_on = [module.vpc]
}

# RDS PostgreSQL
module "rds" {
  source = "./modules/rds"
  
  db_name     = var.db_name
  db_username = var.db_username
  db_password = var.db_password
  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.private_subnet_ids
  
  depends_on = [module.vpc]
}

# DynamoDB Tables
module "dynamodb" {
  source = "./modules/dynamodb"
  
  environment = var.environment
}

# S3 Bucket
module "s3" {
  source = "./modules/s3"
  
  bucket_name = var.s3_bucket_name
  environment = var.environment
}

# MSK (Managed Kafka)
module "msk" {
  source = "./modules/msk"
  
  cluster_name = var.msk_cluster_name
  vpc_id       = module.vpc.vpc_id
  subnet_ids   = module.vpc.private_subnet_ids
  
  depends_on = [module.vpc]
}

# SQS Queue
resource "aws_sqs_queue" "notification_queue" {
  name                      = "notification-queue-${var.environment}"
  message_retention_seconds = 86400
  visibility_timeout_seconds = 60
}

# Lambda Functions
module "lambda" {
  source = "./modules/lambda"
  
  s3_bucket_id           = module.s3.bucket_id
  notification_queue_url = aws_sqs_queue.notification_queue.url
  kafka_brokers          = module.msk.bootstrap_brokers
  course_service_url     = "http://course-service:8081"
  
  depends_on = [module.s3, module.msk]
}

# Application Load Balancer
module "alb" {
  source = "./modules/alb"
  
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.public_subnet_ids
  
  depends_on = [module.vpc]
}

# Outputs
output "eks_cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  value = module.rds.db_endpoint
}

output "msk_bootstrap_brokers" {
  value = module.msk.bootstrap_brokers
}

output "s3_bucket_name" {
  value = module.s3.bucket_name
}

output "alb_dns_name" {
  value = module.alb.dns_name
}

