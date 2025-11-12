# GitOps Compliance Guide

## Requirements

According to the project requirements:
> "All Kubernetes deployments and application updates must be managed via a GitOps controller (e.g., ArgoCD, Flux). The controller must track a Git repository. **Direct kubectl apply is forbidden for service deployment.**"

## When to Use kubectl

### ✅ ALLOWED - Infrastructure & Setup
1. **Installing ArgoCD itself** - Required to bootstrap GitOps
   ```bash
   kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
   ```

2. **Configuring ArgoCD Applications** - Setting up GitOps configuration
   ```bash
   kubectl apply -f gitops/argocd-app.yaml
   ```

3. **Administrative tasks** - Debugging, viewing logs, port-forwarding
   ```bash
   kubectl get pods
   kubectl logs <pod-name>
   kubectl port-forward svc/argocd-server -n argocd 8080:443
   ```

### ❌ FORBIDDEN - Service Deployments
1. **Deploying microservices** - Must use ArgoCD
   ```bash
   # ❌ WRONG
   kubectl apply -f k8s/base/user-service/deployment.yaml
   
   # ✅ CORRECT - ArgoCD handles this automatically from Git
   ```

2. **Updating services** - Must commit to Git, ArgoCD syncs
   ```bash
   # ❌ WRONG
   kubectl set image deployment/user-service user-service=...
   
   # ✅ CORRECT
   git commit -am "Update user-service image"
   git push origin main
   # ArgoCD automatically syncs
   ```

3. **Scaling services** - Should use HPA or update Git manifests
   ```bash
   # ❌ WRONG
   kubectl scale deployment user-service --replicas=5
   
   # ✅ CORRECT - Update HPA or deployment manifest in Git
   ```

## GitOps Workflow

### For Microservice Deployments:

1. **Make changes** to Kubernetes manifests in `k8s/base/`
2. **Commit to Git**:
   ```bash
   git add k8s/base/
   git commit -m "Update service configuration"
   git push origin main
   ```
3. **ArgoCD automatically syncs** (if auto-sync enabled)
   OR
   **Manually sync via ArgoCD UI/CLI**:
   ```bash
   argocd app sync education-platform
   ```

### For New Services:

1. **Add manifests** to `k8s/base/`
2. **Update** `k8s/base/kustomization.yaml`
3. **Commit and push** to Git
4. **ArgoCD detects** and deploys automatically

## Current Project Status

### ✅ Compliant
- All microservice manifests in `k8s/base/` are tracked by Git
- ArgoCD Application configured in `gitops/argocd-app.yaml`
- ArgoCD watches Git repository and auto-deploys changes
- No direct `kubectl apply` for microservices

### ⚠️ Partially Compliant
- Observability stack (Prometheus, Grafana, Loki) - Can be managed by ArgoCD
  - Solution: Added `gitops/observability-app.yaml` for GitOps management
- Secrets/ConfigMaps - Included in Git, managed by ArgoCD via kustomization

## Verification

To verify GitOps compliance:

```bash
# Check ArgoCD applications
kubectl get applications -n argocd

# Check sync status
argocd app get education-platform

# View ArgoCD UI
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Open https://localhost:8080
```

## Summary

- **kubectl is needed** for initial setup and administrative tasks
- **kubectl should NOT be used** for deploying or updating microservices
- **All service deployments** must go through Git → ArgoCD → Kubernetes
- **This project is GitOps compliant** ✅

