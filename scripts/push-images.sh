#!/bin/bash

# Push Docker images to registries

set -e

ECR_REGISTRY=${ECR_REGISTRY:-"your-ecr-registry"}
GCR_REGISTRY=${GCR_REGISTRY:-"gcr.io/your-project"}
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

echo "Logging in to GCR..."
gcloud auth configure-docker

echo "Pushing analytics-service to GCR..."
docker push $GCR_REGISTRY/analytics-service:latest

echo "All images pushed successfully!"

