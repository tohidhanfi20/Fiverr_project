# Deployment Guide

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **GCP Account** with billing enabled
3. **Terraform** >= 1.5.0
4. **kubectl** >= 1.28
5. **AWS CLI** configured
6. **GCP CLI** configured
7. **Docker** installed
8. **Git** repository for GitOps

## Step 1: Infrastructure Provisioning

### AWS Infrastructure

```bash
cd infrastructure/aws

# Initialize Terraform
terraform init

# Create terraform.tfvars
cat > terraform.tfvars <<EOF
aws_region = "us-east-1"
environment = "production"
db_password = "your-secure-password"
EOF

# Plan
terraform plan

# Apply
terraform apply
```

**Note**: Save the outputs (EKS endpoint, RDS endpoint, MSK brokers, etc.) for later use.

### Azure Infrastructure

```bash
cd infrastructure/azure

# Initialize Terraform
terraform init

# Create terraform.tfvars
cat > terraform.tfvars <<EOF
azure_subscription_id = "your-azure-subscription-id"
azure_tenant_id = "your-azure-tenant-id"
azure_region = "eastus"
db_password = "your-secure-password"
hdinsight_password = "your-hdinsight-password"
EOF

# Plan
terraform plan

# Apply
terraform apply
```

## Step 2: Configure Kubernetes Access

### AWS EKS

```bash
aws eks update-kubeconfig --name education-platform-eks --region us-east-1
```

### Azure AKS

```bash
az aks get-credentials --resource-group education-platform-analytics-rg --name education-platform-analytics-aks
```

## Step 3: Set Up Database

### AWS RDS

```bash
# Connect to RDS and run schema
psql -h <RDS_ENDPOINT> -U postgres -d education_db -f database/schema.sql
```

### Azure Database for PostgreSQL

```bash
# Connect to Azure PostgreSQL and run analytics schema
psql -h education-platform-analytics-db.postgres.database.azure.com -U analytics_admin@education-platform-analytics-db -d analytics_db -f database/schema.sql
```

## Step 4: Update Kubernetes Secrets and ConfigMaps

**IMPORTANT**: According to GitOps requirements, we should NOT use `kubectl apply` for service deployments. However, Secrets and ConfigMaps can be managed via ArgoCD or applied once during initial setup.

### Option A: Managed by ArgoCD (Recommended)
Secrets and ConfigMaps are included in `k8s/base/kustomization.yaml`, so ArgoCD will manage them automatically.

### Option B: One-time Initial Setup (If needed)
```bash
# Edit k8s/base/secrets.yaml with actual values
# Edit k8s/base/configmaps.yaml with actual Kafka brokers and SQS URL
# Then commit and push to Git - ArgoCD will sync automatically
git add k8s/base/secrets.yaml k8s/base/configmaps.yaml
git commit -m "Update secrets and configmaps"
git push origin main
```

## Step 5: Build and Push Docker Images

### Build Images

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Build all images
./scripts/build-images.sh
```

### Push to Registries

```bash
# Update ECR_REGISTRY and GCR_REGISTRY in scripts/push-images.sh
./scripts/push-images.sh
```

### Update Kubernetes Manifests

Replace `<ECR_REGISTRY>` in all deployment.yaml files with your actual ECR registry URL.

## Step 6: Deploy Observability Stack via GitOps

**IMPORTANT**: To comply with GitOps requirements, observability stack should also be managed by ArgoCD.

### Option A: Add to ArgoCD (Recommended)
Create an ArgoCD Application for observability:

```bash
# Create observability ArgoCD app
kubectl apply -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: observability-stack
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/tohidhanfi20/Fiverr_project.git
    targetRevision: main
    path: observability
  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
    - CreateNamespace=true
EOF
```

### Option B: One-time Setup (If observability is considered infrastructure)
If observability is treated as infrastructure (not application), you can use kubectl once:
```bash
kubectl create namespace monitoring
kubectl apply -f observability/prometheus/
kubectl apply -f observability/grafana/
kubectl apply -f observability/loki/
```

## Step 7: Deploy GitOps (ArgoCD)

**NOTE**: Installing ArgoCD itself requires `kubectl` - this is acceptable as ArgoCD is infrastructure, not an application service.

```bash
# Install ArgoCD (Infrastructure - kubectl is acceptable)
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for ArgoCD to be ready
kubectl wait --for=condition=available --timeout=300s deployment/argocd-server -n argocd

# Get ArgoCD admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Port forward to access ArgoCD UI
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Update gitops/argocd-app.yaml with your Git repository URL
# Then apply ArgoCD applications (this is configuring GitOps, not deploying services)
kubectl apply -f gitops/argocd-app.yaml
kubectl apply -f gitops/observability-app.yaml
```

**After this point, ALL microservice deployments are handled by ArgoCD automatically from Git!**

## Step 8: Deploy Flink Job to Azure HDInsight

```bash
# Build Flink job JAR
cd stream-processing
mvn clean package

# Upload JAR to Azure Blob Storage
az storage blob upload \
  --account-name <storage-account-name> \
  --container-name analytics-data \
  --name flink-jobs/learning-analytics-flink-1.0.0.jar \
  --file target/learning-analytics-flink-1.0.0.jar

# Submit job to HDInsight Flink cluster
# Access HDInsight cluster via SSH or Ambari UI
# Submit Flink job using Flink CLI or REST API
# Example: flink run -c com.education.analytics.LearningAnalyticsJob wasbs://analytics-data@<storage-account>.blob.core.windows.net/flink-jobs/learning-analytics-flink-1.0.0.jar
```

## Step 9: Deploy Lambda Functions

```bash
cd infrastructure/aws/modules/lambda

# Lambda functions are automatically deployed via Terraform
# If you need to update them manually:
aws lambda update-function-code \
  --function-name file-processor \
  --zip-file fileb://file-processor.zip

aws lambda update-function-code \
  --function-name notification-processor \
  --zip-file fileb://notification-processor.zip
```

## Step 10: Configure ALB Ingress

```bash
# Install AWS Load Balancer Controller
kubectl apply -k "https://github.com/aws/eks-charts/stack/aws-load-balancer-controller/crds?ref=master"

# Create ingress for web service
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-service-ingress
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
spec:
  ingressClassName: alb
  rules:
  - http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: web-service
            port:
              number: 3000
EOF
```

## Step 11: Verify Deployment

```bash
# Check all pods
kubectl get pods

# Check services
kubectl get services

# Check HPA
kubectl get hpa

# Check ArgoCD applications
kubectl get applications -n argocd
```

## Step 12: Run Load Tests

```bash
cd load-testing

# Install k6 (if not installed)
# See: https://k6.io/docs/getting-started/installation/

# Run load test
k6 run load-test.js --out json=results.json

# Monitor HPA scaling
watch kubectl get hpa
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod logs
kubectl logs <pod-name>

# Check pod events
kubectl describe pod <pod-name>
```

### Database Connection Issues

- Verify security groups allow traffic from EKS nodes
- Check RDS endpoint is correct in secrets
- Verify database credentials

### Kafka Connection Issues

- Verify MSK security groups allow traffic from EKS
- Check Kafka brokers are correct in ConfigMap
- Verify network connectivity

### HPA Not Scaling

```bash
# Check HPA status
kubectl describe hpa <hpa-name>

# Check metrics server
kubectl top nodes
kubectl top pods
```

## Monitoring

### Access Grafana

```bash
kubectl port-forward svc/grafana 3000:3000
# Open http://localhost:3000
# Login: admin/admin
```

### Access Prometheus

```bash
kubectl port-forward svc/prometheus 9090:9090
# Open http://localhost:9090
```

### Access ArgoCD

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Open https://localhost:8080
```

## Next Steps

1. Set up CI/CD pipeline (GitHub Actions/GitLab CI)
2. Configure custom domain and SSL certificates
3. Set up alerting rules in Prometheus
4. Configure backup strategies for databases
5. Implement monitoring dashboards in Grafana
6. Set up log aggregation (Loki/EFK stack)

