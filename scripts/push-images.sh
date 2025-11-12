#!/bin/bash

# Push Docker images to registries

set -e

ECR_REGISTRY=${ECR_REGISTRY:-"your-ecr-registry"}
ACR_REGISTRY=${ACR_REGISTRY:-"your-registry.azurecr.io"}
AWS_REGION=${AWS_REGION:-"us-east-1"}

SERVICES=(
  "user-service"
  "course-service"
  "enrollment-service"
  "progress-service"
  "web-service"
)

echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY

echo "Pushing images to ECR..."
for service in "${SERVICES[@]}"; do
  echo "Pushing $service..."
  docker push $ECR_REGISTRY/$service:latest
done

echo "Logging in to Azure Container Registry..."
az acr login --name $(echo $ACR_REGISTRY | cut -d'.' -f1)

echo "Pushing analytics-service to ACR..."
docker push $ACR_REGISTRY/analytics-service:latest

echo "All images pushed successfully!"

