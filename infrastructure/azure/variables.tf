variable "azure_subscription_id" {
  description = "Azure Subscription ID"
  type        = string
}

variable "azure_tenant_id" {
  description = "Azure Tenant ID"
  type        = string
}

variable "azure_region" {
  description = "Azure Region"
  type        = string
  default     = "eastus"
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "hdinsight_password" {
  description = "HDInsight cluster password"
  type        = string
  sensitive   = true
}

