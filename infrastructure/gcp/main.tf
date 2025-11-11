terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
  
  backend "gcs" {
    bucket = "education-platform-terraform-state"
    prefix = "gcp/terraform.tfstate"
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

# GKE Cluster for Analytics Service
resource "google_container_cluster" "analytics" {
  name     = "education-platform-analytics-gke"
  location = var.gcp_region

  remove_default_node_pool = true
  initial_node_count       = 1

  network    = google_compute_network.main.name
  subnetwork = google_compute_subnetwork.main.name

  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = "0.0.0.0/0"
      display_name = "All"
    }
  }
}

resource "google_container_node_pool" "analytics" {
  name       = "analytics-node-pool"
  cluster    = google_container_cluster.analytics.name
  location   = var.gcp_region
  node_count = 2

  node_config {
    machine_type = "e2-medium"
    disk_size_gb = 50

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]
  }
}

# Cloud SQL (PostgreSQL) for Analytics
resource "google_sql_database_instance" "analytics" {
  name             = "education-platform-analytics-db"
  database_version = "POSTGRES_15"
  region           = var.gcp_region

  settings {
    tier = "db-f1-micro"
    
    backup_configuration {
      enabled = true
    }

    ip_configuration {
      ipv4_enabled = true
    }
  }
}

resource "google_sql_database" "analytics" {
  name     = "analytics_db"
  instance = google_sql_database_instance.analytics.name
}

resource "google_sql_user" "analytics" {
  name     = "analytics_user"
  instance = google_sql_database_instance.analytics.name
  password = var.db_password
}

# Cloud Storage for Analytics Data
resource "google_storage_bucket" "analytics" {
  name          = "education-platform-analytics-${var.gcp_project_id}"
  location      = var.gcp_region
  force_destroy = true

  versioning {
    enabled = true
  }
}

# Dataproc Cluster for Flink
resource "google_dataproc_cluster" "flink" {
  name   = "education-platform-flink"
  region = var.gcp_region

  cluster_config {
    master_config {
      num_instances = 1
      machine_type  = "n1-standard-2"
    }

    worker_config {
      num_instances = 2
      machine_type  = "n1-standard-2"
    }

    software_config {
      image_version = "2.1-debian11"
    }
  }
}

# VPC Network
resource "google_compute_network" "main" {
  name                    = "education-platform-network"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "main" {
  name          = "education-platform-subnet"
  ip_cidr_range = "10.1.0.0/24"
  region        = var.gcp_region
  network       = google_compute_network.main.id
}

# Outputs
output "gke_cluster_endpoint" {
  value = google_container_cluster.analytics.endpoint
}

output "cloud_sql_connection_name" {
  value = google_sql_database_instance.analytics.connection_name
}

output "gcs_bucket_name" {
  value = google_storage_bucket.analytics.name
}

output "dataproc_cluster_name" {
  value = google_dataproc_cluster.flink.name
}

