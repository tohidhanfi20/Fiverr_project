# Cloud-Based Education Platform

A comprehensive multi-cloud microservices application for an online learning management system, deployed on AWS and Microsoft Azure.

## Architecture Overview

- **6 Microservices** deployed on AWS EKS and Azure AKS
- **Real-time Stream Processing** using Apache Flink on Azure HDInsight
- **Infrastructure as Code** using Terraform
- **GitOps** deployment with ArgoCD
- **Comprehensive Observability** with Prometheus, Grafana, and Loki
- **Load Testing** with k6

## Project Structure

```
.
├── design-document.md          # Complete design documentation
├── microservices/              # All microservice code
│   ├── web-service/            # Public web frontend
│   ├── user-service/           # User management
│   ├── course-service/         # Course catalog
│   ├── enrollment-service/     # Enrollment management
│   ├── progress-service/       # Student progress tracking
│   └── analytics-service/      # Analytics (Azure)
├── infrastructure/             # Terraform IaC
│   ├── aws/                    # AWS infrastructure
│   └── azure/                  # Azure infrastructure
├── k8s/                        # Kubernetes manifests
│   ├── base/                   # Base manifests
│   └── overlays/               # Environment overlays
├── gitops/                     # ArgoCD configuration
├── observability/              # Prometheus, Grafana, Loki configs
├── stream-processing/          # Flink job code
├── serverless/                 # Lambda functions
└── load-testing/               # k6 test scripts
```

## Prerequisites

- Terraform >= 1.5.0
- kubectl >= 1.28
- AWS CLI configured
- Azure CLI configured
- Docker
- Node.js 18+ (for microservices)
- Python 3.9+ (for some services)

## Quick Start

### 1. Infrastructure Provisioning

```bash
# Provision AWS infrastructure
cd infrastructure/aws
terraform init
terraform plan
terraform apply

# Provision Azure infrastructure
cd ../azure
terraform init
terraform plan
terraform apply
```

### 2. Configure Kubernetes Access

```bash
# AWS EKS
aws eks update-kubeconfig --name education-platform-eks --region us-east-1

# Azure AKS
az aks get-credentials --resource-group education-platform-analytics-rg --name education-platform-analytics-aks
```

### 3. Deploy GitOps (ArgoCD)

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl apply -f gitops/argocd-app.yaml
```

### 4. Deploy Observability Stack

```bash
kubectl apply -f observability/prometheus/
kubectl apply -f observability/grafana/
kubectl apply -f observability/loki/
```

### 5. Build and Push Docker Images

```bash
# Build all services
./scripts/build-images.sh

# Push to ECR/ACR
./scripts/push-images.sh
```

### 6. Deploy Applications via GitOps

ArgoCD will automatically deploy applications from the Git repository. Monitor deployment:

```bash
kubectl get applications -n argocd
argocd app sync <app-name>
```

## Services

### Web Service
- **Port**: 3000
- **Public URL**: Available via ALB
- **Endpoints**: `/`, `/courses`, `/enroll`, etc.

### User Service
- **Port**: 8080
- **Database**: RDS PostgreSQL
- **Endpoints**: `/api/users/*`

### Course Service
- **Port**: 8081
- **Database**: RDS PostgreSQL
- **Storage**: S3
- **Endpoints**: `/api/courses/*`

### Enrollment Service
- **Port**: 8082
- **Database**: RDS PostgreSQL
- **Endpoints**: `/api/enrollments/*`

### Progress Service
- **Port**: 8083
- **Database**: RDS PostgreSQL
- **Endpoints**: `/api/progress/*`

### Analytics Service (Azure)
- **Port**: 8085
- **Database**: Azure Database for PostgreSQL
- **Endpoints**: `/api/analytics/*`

## Load Testing

```bash
cd load-testing
k6 run load-test.js
```

## Monitoring

- **Grafana**: http://grafana.example.com (after port-forwarding)
- **Prometheus**: http://prometheus.example.com
- **ArgoCD**: http://argocd.example.com

## Documentation

See [DESIGN_DOCUMENT.md](./DESIGN_DOCUMENT.md) for complete architecture and design details.

## License

MIT

