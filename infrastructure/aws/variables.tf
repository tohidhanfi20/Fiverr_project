variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "education-platform-eks"
}

variable "eks_node_group_size" {
  description = "EKS node group size"
  type        = number
  default     = 3
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "education_db"
}

variable "db_username" {
  description = "Database username"
  type        = string
  default     = "postgres"
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "s3_bucket_name" {
  description = "S3 bucket name"
  type        = string
  default     = "education-platform-storage"
}

variable "msk_cluster_name" {
  description = "MSK cluster name"
  type        = string
  default     = "education-platform-msk"
}

