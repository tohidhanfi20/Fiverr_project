terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
  
  backend "azurerm" {
    resource_group_name  = "education-platform-terraform-state"
    storage_account_name = "edutformstate"
    container_name       = "terraform-state"
    key                  = "azure/terraform.tfstate"
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.azure_subscription_id
  tenant_id       = var.azure_tenant_id
}

# Resource Group
resource "azurerm_resource_group" "main" {
  name     = "education-platform-analytics-rg"
  location = var.azure_region
}

# Virtual Network
resource "azurerm_virtual_network" "main" {
  name                = "education-platform-vnet"
  address_space       = ["10.1.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

# Subnet
resource "azurerm_subnet" "main" {
  name                 = "education-platform-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.1.0.0/24"]
}

# AKS Cluster for Analytics Service
resource "azurerm_kubernetes_cluster" "analytics" {
  name                = "education-platform-analytics-aks"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = "education-analytics"
  kubernetes_version  = "1.28"

  default_node_pool {
    name       = "default"
    node_count = 2
    vm_size    = "Standard_B2s"
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin = "azure"
  }
}

# Azure Database for PostgreSQL (Analytics)
resource "azurerm_postgresql_server" "analytics" {
  name                = "education-platform-analytics-db"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  administrator_login          = "analytics_admin"
  administrator_login_password = var.db_password

  sku_name   = "B_Gen5_1"
  version    = "15"
  storage_mb = 5120

  backup_retention_days        = 7
  geo_redundant_backup_enabled = false
  auto_grow_enabled            = true

  ssl_enforcement_enabled = true
}

resource "azurerm_postgresql_database" "analytics" {
  name                = "analytics_db"
  resource_group_name = azurerm_resource_group.main.name
  server_name         = azurerm_postgresql_server.analytics.name
  charset             = "UTF8"
  collation           = "English_United States.1252"
}

resource "azurerm_postgresql_firewall_rule" "allow_azure" {
  name                = "AllowAzureServices"
  resource_group_name = azurerm_resource_group.main.name
  server_name         = azurerm_postgresql_server.analytics.name
  start_ip_address    = "0.0.0.0"
  end_ip_address      = "0.0.0.0"
}

# Azure Blob Storage for Analytics Data
resource "azurerm_storage_account" "analytics" {
  name                     = "eduanalytics${substr(md5(azurerm_resource_group.main.name), 0, 8)}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"

  blob_properties {
    versioning_enabled = true
  }
}

resource "azurerm_storage_container" "analytics" {
  name                  = "analytics-data"
  storage_account_name  = azurerm_storage_account.analytics.name
  container_access_type = "private"
}

# Azure HDInsight for Flink Stream Processing
# Note: HDInsight Flink clusters are created via HDInsight Spark cluster with Flink installed
# Alternative: Use Azure Databricks or Azure Synapse Analytics for Flink
resource "azurerm_hdinsight_spark_cluster" "flink" {
  name                = "education-platform-flink"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  cluster_version     = "4.0"
  tier                = "Standard"

  component_version {
    spark = "3.3"
  }

  gateway {
    enabled  = true
    username = "admin"
    password = var.hdinsight_password
  }

  roles {
    head_node {
      vm_size   = "Standard_D4s_v3"
      username  = "sshuser"
      password  = var.hdinsight_password
    }

    worker_node {
      vm_size               = "Standard_D4s_v3"
      username              = "sshuser"
      password              = var.hdinsight_password
      target_instance_count = 2
    }

    zookeeper_node {
      vm_size  = "Standard_D2s_v3"
      username = "sshuser"
      password = var.hdinsight_password
    }
  }

  storage_account {
    storage_container_id = azurerm_storage_container.analytics.id
    storage_account_key  = azurerm_storage_account.analytics.primary_access_key
    is_default           = true
  }

  tags = {
    Environment = "Production"
    Purpose     = "Flink Stream Processing"
  }
}

# Outputs
output "aks_cluster_name" {
  value = azurerm_kubernetes_cluster.analytics.name
}

output "aks_cluster_fqdn" {
  value = azurerm_kubernetes_cluster.analytics.fqdn
}

output "postgresql_server_fqdn" {
  value = azurerm_postgresql_server.analytics.fqdn
}

output "storage_account_name" {
  value = azurerm_storage_account.analytics.name
}

output "hdinsight_cluster_name" {
  value = azurerm_hdinsight_spark_cluster.flink.name
}

output "hdinsight_cluster_https_endpoint" {
  value = azurerm_hdinsight_spark_cluster.flink.https_endpoint
}

output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

