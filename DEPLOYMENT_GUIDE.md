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

### GCP Infrastructure

```bash
cd infrastructure/gcp

# Initialize Terraform
terraform init

# Create terraform.tfvars
cat > terraform.tfvars <<EOF
gcp_project_id = "your-gcp-project-id"
gcp_region = "us-central1"
db_password = "your-secure-password"
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

### GCP GKE

```bash
gcloud container clusters get-credentials education-platform-analytics-gke --region us-central1
```

## Step 3: Set Up Database

### AWS RDS

```bash
# Connect to RDS and run schema
psql -h <RDS_ENDPOINT> -U postgres -d education_db -f database/schema.sql
```

### GCP Cloud SQL

```bash
# Connect to Cloud SQL and run analytics schema
gcloud sql connect education-platform-analytics-db --user=analytics_user
# Then run the analytics database schema from database/schema.sql
```

## Step 4: Create Kubernetes Secrets and ConfigMaps

### Update Secrets

```bash
# Edit k8s/base/secrets.yaml with actual values
kubectl apply -f k8s/base/secrets.yaml
```

### Update ConfigMaps

```bash
# Edit k8s/base/configmaps.yaml with actual Kafka brokers and SQS URL
kubectl apply -f k8s/base/configmaps.yaml
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

## Step 6: Deploy Observability Stack

```bash
# Deploy Prometheus
kubectl apply -f observability/prometheus/

# Deploy Grafana
kubectl apply -f observability/grafana/

# Deploy Loki (if using)
# kubectl apply -f observability/loki/
```

## Step 7: Deploy GitOps (ArgoCD)

```bash
# Install ArgoCD
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for ArgoCD to be ready
kubectl wait --for=condition=available --timeout=300s deployment/argocd-server -n argocd

# Get ArgoCD admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Port forward to access ArgoCD UI
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Update gitops/argocd-app.yaml with your Git repository URL
kubectl apply -f gitops/argocd-app.yaml
```

## Step 8: Deploy Flink Job to Dataproc

```bash
# Build Flink job JAR
cd stream-processing
mvn clean package

# Upload JAR to GCS
gsutil cp target/learning-analytics-flink-1.0.0.jar gs://your-bucket/flink-jobs/

# Submit job to Dataproc
gcloud dataproc jobs submit spark \
  --cluster=education-platform-flink \
  --region=us-central1 \
  --class=com.education.analytics.LearningAnalyticsJob \
  --jars=gs://your-bucket/flink-jobs/learning-analytics-flink-1.0.0.jar \
  --properties=spark.executor.memory=2g,spark.executor.cores=2
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

